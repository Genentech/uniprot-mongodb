/**
 * Load a local uniprot .dat file into a mongo database
 *
 *
 * Copyright (c) 2014, Genentech Inc.
 * @author masselot.alexandre@gene.com, Bioinformatics & Computational Biology, Genentech
 */


var MongoClient = require('mongodb').MongoClient;
var fs = require('fs');
var zlib = require('zlib');

var uniprotReader = new (require('Uniprot').Reader)();

//var fr = require('./FastaReader.js')

var argv = require('optimist')
    .usage('Usage: $0 [--mongodb-host=localhost] [--mongodb-port=27017] [--mongodb-database=proteins] [--name=uniprot_XXX] --format=(uniprot|fasta) --input-file=local_file')
    .demand(['input-file', 'name', 'format'])
    .argv;

if(argv.help){
    optimist.showHelp();
    process.exit(code = 0);
}

var mongoHost = argv['mongodb-host'] || 'localhost';
var mongoPort = argv['mongodb-port'] || '27017';
var mongoDB = argv['mongodb-database'] || 'proteins';
var mongoCollection = argv.name;
var mongoUrl = 'mongodb://' + mongoHost + ':' + mongoPort + '/' + mongoDB;

var datSrc = argv['input-file'];
var inputFormat = argv.format;
if (inputFormat !== 'fasta' && inputFormat !== 'uniprot') {
    throw "--format=(uniprot|fasta)"
}
console.log('loading', datSrc, 'into', mongoUrl + '/' + mongoCollection);

/**
 * create a stream of uniprot entries
 * each entry can then be derived in several isoforms
 * It is a bir crude to do it here, but full uniprot fle does not load in memory with all the constructed
 */
var initDatReader = function (fname, callback, endCallback) {

    var srcStream = fs.createReadStream(fname);
    var stream;
    if (fname.match(/\.gz$/)) {
        console.log('uncompressing gziped file');
        stream = zlib.createGunzip();
        srcStream.pipe(stream);
    } else {
        stream = srcStream;
    }

    var stack = '';

    function read() {
        var buf;
        while (buf = stream.read()) {
            stack += buf;
            while (( i = stack.indexOf("\n//")) >= 0) {
                var dat = stack.substr(0, i + 3);
                stack = stack.substr(i + 3);
                callback(dat)
            }
        }
    }

    stream.on('readable', read);

    stream.once('end', function () {
        endCallback(function () {
            console.log('load completed');
            //it is faster to build the indexes at the end
            buildIndexes()
        })
    });
}
function buildIndexes() {
    MongoClient.connect(mongoUrl, function (err, db) {
        if (err) {
            console.error(err)
            throw err;
        }
        db.collection(mongoCollection, function (err, collection) {
            if (err)
                throw err;

            function ensureIndexes(idxStack) {
                if (idxStack.length == 0) {
                    db.close();
                    process.exit(code = 0);
                }
                var idx = idxStack.shift();
                console.log('ensureIndex', idx);
                collection.ensureIndex(idx, function (err, name) {
                    if (err) {
                        console.error('cannot create index:$name ', err)
                        throw err;
                    }
                    ensureIndexes(idxStack);
                });
            }

            ensureIndexes([
                {
                    trypticCtermTags: 1
                },
                {
                    accessionCodes: true,
                    unique: true
                },
                {
                    ncbi_taxid: true
                }
            ])

        })
    })
}

MongoClient.connect(mongoUrl, function (err, db) {
    if (err) {
        console.error(err)
        throw err;
    }
    db.collection(mongoCollection, function (err, collection) {
        if (err)
            throw err;

        /* entries are not inserted one after the other, that would be too much transactions.
         * so we pack them by 10'000 and insert them by batch
         */

        var buffer = []
        var chunkSize = 1000;
        var pushEntries = function (entry) {
            buffer.push(entry)

            if (buffer.length == chunkSize) {
                insertEntries(buffer)
                buffer = new Array()
            }

        }
        var ntot = 0
        var insertEntries = function (list, callback) {
            ntot += list.length
            console.log('inserting ', ntot)
            collection.insert(list, function (err, result) {
                if (err) {
                    console.error('inserting problem', err)
                    throw err;
                }
                if (callback) {
                    callback()
                }
            })
        }
        if (inputFormat === 'uniprot') {
            initDatReader(datSrc, function (txt) {
                if (err)
                    throw err;

                uniprotReader.datEntries(txt).forEach(function (dat1) {
                    uniprotReader.buildIsoformEntries(dat1).forEach(function (isoform) {
                        decorateEntry(isoform);
                        pushEntries(isoform)
                    })
                    // var entry = reader.buildCanonicalEntry(dat1)
                    // entry._id = entry.id
                    // entry.accessionCodes.push(entry.id)
                    // pushEntries(entry)
                })
            }, function (callback) {
                insertEntries(buffer, callback)
            });
        } else if (inputFormat === 'fasta') {
            var reader = new fr.FastaReader();
            reader.streamBlocks(datSrc, function (cont) {
                var e = reader.buildSeqEntry(cont);
                pushEntries(e);
            }, function () {
                insertEntries(buffer, function () {
                    buildIndexes();
                });
            });
        } else {
            throw 'unknown format:' + inputFormat;
        }
        console.log('load launched for ' + datSrc)
    });
});

/**
 * it's not tryptice, because we only care about peptide ending by K or R (at search time, we do not know if we have a P after...)
 * @param {Object} e
 */
function decorateEntry(e) {
    //    e.trypticCterm4=e.sequence.match(/(.*?([KR]|$))(?!P)/g).filter(function(p){return p.length>=4}).map(function(p){return p.substr(-4)})
    var es = e.sequence.match(/.*?([KR]|$)/g).reverse()
    es.shift();
    var tagSize = 4;
    e.trypticCtermTags = es.map(function (tag, i) {
        for (j = i + 1; j < es.length && tag.length < tagSize; j++) {
            tag = es[j] + tag
        }
        ;
        return tag
    }).reverse().filter(function (p) {
        return p.length >= tagSize
    }).map(function (p) {
        return p.substr(-tagSize);
    })
    e.trypticPeptides = e.sequence.match(/(.*?([KR]|$))(?!P)/g).filter(function (p) {
        return p.length > 4
    })
}
