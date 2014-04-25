/*
 * a nodejs backed server to access mongodb loaded uniprot file
 *
 * url example
 * http://localhost:9007/uniprot/byseq/DEFR -> all isoforms with a peptide containing DEFR
 *
 * Copyright (c) 2014, Genentech Inc.
 * @author masselot.alexandre@gene.com, Bioinformatics & Computational Biology, Genentech
 */
var http = require('http');
var express = require('express');
var optimist = require('optimist');
var swagger = require("swagger-node-express");
var _ = require('lodash');

/*
 * application params
 */
var argv = optimist.usage('Usage: $0 [--mongodb-host=localhost] [--mongodb-port=27017] [--mongodb-database=proteins] [--listen-port=9408]').argv;

if(argv.help){
    optimist.showHelp();
    process.exit(code = 0);
}

var serverPort = argv['listen-port'] || 9408;

/**
 * setup mongo connection from arguments
 */
var MongoClient = require('mongodb').MongoClient, Server = require('mongodb').Server;

var mongoHost = argv['mongodb-host'] || 'localhost';
var mongoPort = argv['mongodb-port'] || '27017';
var mongoDB = argv['mongodb-database'] || 'proteins';

var mongoclient = new MongoClient(new Server(mongoHost, mongoPort));
var db = mongoclient.db(mongoDB);


/**
 *setup express application
 */

var app = express();
app.use(express.json());
app.use(express.urlencoded());
app.use(app.router);

// Handler for internal server errors
function errorHandler(err, req, res, next) {
    console.error(err.message);
    console.error(err.stack);
    res.status(500);
    res.send("Error:" + err.message);
}

app.use(errorHandler);

function jsonHandler(err, doc) {

}

/*
 * route & actions
 */

var listSources = {
    'spec': {
        "description": "Get by accession codes or UniProt ids or accession codes",
        //        "path" : "/uniprot.{format}/{ids}",
        "path": "/proteins/sources",
        "notes": "just names of the db sources (to be later used in the /proteins/ urls",
        "summary": "list all sources",
        "method": "GET",
        "parameters": [],
        "errorResponses": [],
        "nickname": "listSources"
    },
    'action': function (req, res) {
        db.collectionNames(function (err, data) {
            res.json(_.chain(data)
                    .pluck('name')
                    .map(function (n) {
                        return n.replace(mongoDB + '.', '');
                    })
                    .filter(function (n) {
                        return n !== 'system.indexes';
                    })
                    .value()
            );
        });
    }
};

var findByIds = {
    'spec': {
        "description": "Get by accession codes or UniProt ids or accession codes",
        //        "path" : "/uniprot.{format}/{ids}",
        "path": "/proteins/{srcDatabase}/{ids}",
        "notes": "one the main sequence has all the synonyms isoforms",
        "summary": "find you proteins by id/ac (multiple separated by commas)",
        "method": "GET",
        "parameters": [
            swagger.params.path("srcDatabase", "source database name (can include version)", "string"),
            swagger.params.path("ids", "AC/ID field from database entry", "string"),
            swagger.params.query("format", "returned format", "string", false, ["json", "fasta"], "json")
        ],
        "responseClass": "Protein",
        //"errorResponses": [swagger.errors.invalid('id'), swagger.errors.notFound('sequence')],
        "nickname": "getProteinByids"
    },
    'action': function (req, res) {

        var acs = req.params.ids.split(',');
        var collection = req.params.srcDatabase;
        var ans = db.collection(collection).find({
            accessionCodes: {
                '$in': acs
            }
        }, {
            trypticCtermTags: 0,
            trypticPeptides: 0,
            _id: 0
        });
        if (outFormat(req) === 'json') {
            ans.toArray(function (err, docs) {
                if (err)
                    throw err;
                //re-assemble the documents based on the queried ac
                var ret = {};
                acs.forEach(function (ac) {
                    ret[ac] = _.find(docs, function (e) {
                        return _.contains(e.accessionCodes, ac);
                    })
                });
                res.json(ret);
            });
        } else {
            output(req, res, ans);
        }

    }
};

var findBySubSequence = {
    'spec': {
        "description": "find proteins on sequence containing al the subsequences",
        //        "path" : "/uniprot.{format}/byseq/{seqs}",
        "path": "/proteins/{srcDatabase}/byseq/{seqs}",
        "notes": "goes faster with tryptic c-termini",
        "summary": "give one or more sequence to be found sperated with comma",
        "method": "GET",
        "parameters": [
            swagger.params.path("srcDatabase", "source database name (can include version)", "string"),
            swagger.params.path("seqs", "subsequences", "string"),
            swagger.params.query("output", "returned format", "string", true, ["json", "fasta"], "json")
        ],
        "responseClass": "Protein",
//        "errorResponses": [swagger.errors.invalid('seqs'), swagger.errors.notFound('sequence')],
        "nickname": "getProteinBySequences"
    },
    'action': function (req, res) {
        var seqs = req.params.seqs.split(',');
        var collection = req.params.srcDatabase;

        findBySubSequences(collection, seqs, function (err, docs) {
            output(req, res, docs);
        })
    }
};

var findByOC = {
    'spec': {
        "description": "find proteins by OC (text taxonomy lineage)",
        //        "path" : "/uniprot.{format}/byseq/{seqs}",
        "path": "/proteins/{srcDatabase}/byOC/{oc}",
        "notes": "",
        "summary": "just take into account the lineage entere in the data file (not the full NCBI taxonomy)    ",
        "method": "GET",
        "parameters": [
            swagger.params.path("srcDatabase", "source database name (can include version)", "string"),
            swagger.params.path("oc", "taxonomy", "string"),
            swagger.params.query("output", "returned format", "string", true, ["json", "fasta"], "fasta")
        ],
        "responseClass": "Protein",
        "errorResponses": [],
        "nickname": "getProteinByOC"
    },
    'action': function (req, res) {
        var oc = req.params.oc

        var collection = req.params.srcDatabase;
        var ans = db.collection(collection).find({
            OC: oc
        }, {
            trypticCterm4: 0,
            trypticPeptides: 0
        });
        output(req, res, ans);
    }
};

/*
 * swagger set to document the web service
 * application home pages is redirected to swagger doc
 */
swagger.setAppHandler(app);
var models = require("./models.js");
swagger.addModels(models);

swagger.addGet(listSources);
swagger.addGet(findByIds);
swagger.addGet(findBySubSequence);
swagger.addGet(findByOC);

swagger.configureDeclaration('proteins', {
    description: 'Protein retrieval',
    protocols: ["http"],
    produces: ['application/json', 'text/fasta']
});

swagger.configureSwaggerPaths("", "/api-docs", "");
swagger.configure("/", "0.1");

app.use('/swagger', express.static(__dirname + '/node_modules/swagger-node-express/swagger-ui'));
app.use('/doc', express.static(__dirname + '/public'));
app.get('/', function (req, res) {
    res.redirect('/doc');
});

// Connect to the db
mongoclient.open(function (err, mongoclient) {
    if (err) {
        console.error("ERROR: Cannot connect to mongodb. start the server or setup the conenction parameters");
        console.error(err);
        process.exit();
    }
    app.listen(serverPort);
    console.log('Express server started on port ' + serverPort);
});

/*
 * business code
 */

function findBySubSequences(coll, seqs, resCallback) {
    var seqsKR = [];
    var tagSize = 4;
    seqs.forEach(function (s) {
        if (s.length >= tagSize && /[KR]/.test(s.substr(-1))) {
            seqsKR.push(s)
        }
    });

    var pipeline = [];
    if (seqsKR.length > 0) {
        var tags = seqsKR.map(function (s) {
            return s.substr(-tagSize);
        });
        pipeline.push({
            $match: {
                trypticCtermTags: {
                    $all: tags
                }
            }
        });
    }

    pipeline.push({
        $project: {
            sequence: 1,
            isoformOf: 1,
            id: 1,
            accessionCodes: 1,
            OS: 1,
            ncbi_taxid: 1,
            _id: 0
        }
    });

    pipeline.push({
        $match: {
            sequence: {
                $all: seqs.map(function (s) {
                    return new RegExp(s);
                })
            }
        }
    });

    db.collection(coll).aggregate(pipeline, resCallback)

}

/**
 *
 *
 * @param req
 * @return {*}
 */
function outFormat(req) {
    if (req.query.format === undefined) {
        return 'json'
    }
    return req.query.format;
}

function outputFasta(res, e) {
    var str = '>' + e.id;
    if (!e.isCanonical) {
        str += ' isoformOf=' + e.isoformOf;
    }
    str += '\n';
    var l = e.sequence.length;
    var aSeq = e.sequence.split('');
    var i = 0;
    aSeq.forEach(function (a) {
        str += a;
        i++;
        if (i == l) {
            return;
        }
        if (i % 60 == 0) {
            str += '\n';
            return;
        }
        if (i % 10 == 0) {
            str += ' ';
        }
    });
    res.write(str + '\n');
}

function output(req, res, ans) {
    /*
     ans can be either some inheritance of array (with typeof = object, which is weird, no?) or a mongodb object
     So, we try to take care of the two situations
     */
    if (ans.forEach !== undefined) {
        if (outFormat(req) === 'json') {
            res.json(ans)
        } else {
            ans.forEach(function (e) {
                outputFasta(res, e);
            });
            res.end();
        }
        return;
    }

    if (outFormat(req) === 'json') {

        ans.toArray(function (err, docs) {
            if (err)
                throw err;
            res.json(docs);
        });
        return
    }
    ans.each(function (err, e) {
        if (err) {
            console.error(err);
        }
        if (e === null) {
            res.end();
            return;
        }
        outputFasta(res, e);
    });

}