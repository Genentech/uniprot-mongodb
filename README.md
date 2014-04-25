#uniprot-mongodb

##What is uniprot-mongodb?
It provides a Uniprot based protein data storage into a mongodb database, expanding annotated splice forms.
A server application allows to retrieve proteins from with different types of constraints.

## Install
### Prerequisites
This project depends upon [node.js](http://nodejs.org/) and [mongodb](https://www.mongodb.org/‎). Stable binaries are available for the major operating systems.

### install uniprot-mongodb
Checkout the uniprot-mongodb code and

    npm install
That's it! A `node_modules` should have been created with dependencies downloaded.

#### Notes
<code>"Failed to load c++ bson extension, using pure JS version"</code> warning message can appear (without side effects but minimal speed delay). This is related to older versions of nodejs.

### A Mongodb server
Data are stored on a versatile [mongodb](https://www.mongodb.org/‎) server. From the basic local single node instance to sharded, duplicated one it will not make difference.

You will need to provide a host (default `localhost`), a port (default `27017`) and a database name (default `proteins`). The database does not need to be created beforehand.

#### mongobd administration

See the [mongodb documentation](http://docs.mongodb.org/manual/) for database management.

##How to use it?
### Loading data with `mongo-protein-loader.js`
Protein data (from a Uniprot or fasta format) is to be parsed and loaded to the server.
Once the file is downloaded locally, it can be uploaded to a mongodb server with the `node mongo-protein-loader.js` script.

     #get the uniprot release (or use the date)
     release=$(wget -qO- ftp://ftp.uniprot.org/pub/databases/uniprot/relnotes.txt | head -1 | cut -f3 -d" ")
     echo $release

     #donload Uniprot data file
     localfile=/tmp/uniprot_sprot.dat.gz
     wget -O $localfile ftp://ftp.uniprot.org/pub/databases/uniprot/current_release/knowledgebase/taxonomic_divisions/uniprot_sprot_human.dat.gz

     node mongo-protein-loader.js --input-file=$localfile  --name uniprot_$release --format=uniprot
     #the loading process, for a human sport file should take approximately 1-1.5 minutes on a laptop

A server application can be launched with the `node mongo-protein-server.js` script and protein queries launched via web services. The list of available web services can be retrieved, with documentation, via the [/docs/](http://localhost:9408/doc/) url.

### Querying data

#### Launching the server


Data can be retrieved in several ways. Example are shown here with default url. Full documentation can be found at (http://localhost:9408/doc/).
An optional query parameter `?format=json` or `?format=fasta` can be passed to specify the type of output.


#### The list of available sources [http://localhost:9408/proteins/sources](http://localhost:9408/proteins/sources)
Will return a list of the available data sources, to be used in subsequent queries (all the collections in the set databases).

#### Retrieving proteins by ids or accession codes [http://localhost:9408/proteins/uniprot_2014_03/P84996,ERBB2_HUMAN](http://localhost:9408/proteins/uniprot_2014_03/P84996,ERBB2_HUMAN)
Protein can be retrieved via the uniprot ID or the AC (accession codes) list. Several ids can be passed at once, separated with commas.
A json map id->protein is returned, with the queries id used as a key (not the default Uniprot ID field). In case the returned format is asked to be fasta, it will be the default ID printed into the header.

#### Retrieving proteins by sub sequences [http://localhost:9408/proteins/uniprot_2014_03/byseq/YESK,GDYYRYLA](http://localhost:9408/proteins/uniprot_2014_03/byseq/YESK,GDYYRYLA)
Given a list of sub sequences, proteins containing all the peptides are returned. As the feature was targeted at proteomics, tryptic peptides will return faster although any sub sequence are possible.
More details on how the operation is implemented are given below

#### Retrieving proteins by the taxonomy tree [http://localhost:9408/proteins/uniprot_2014_03/byOC/Homo](http://localhost:9408/proteins/uniprot_2014_03/byOC/Homo)
The list of proteins in a taxonomy branch denominated by the `OC` Uniprot field can be retrieved. The default output format for this query is `fasta`.

##How does it work?
### data structure
[Uniprot.js](github.com/Genentech/uniprot-js) library is used to parse Uniprot file and extract a partial list of information. Isoform are reconstructed whereas some information (such as the PDB cross references for example) will not be propagated.
The parsed objects are then stored into a mongodb collection and indexed by various criteria for faster retrieval (the `AC` field, for example, used in the `findByIds` service).

### Retrieving by sub sequence list: the basic version is not enough
Retrieving proteins containing a list of peptides has been an initial purpose of this system.
Mongodb allows to make such queries by directly applying regular expressions on the sequence field.
However, this basic approach was proven not to be fast enough and a more original route had to be designed.

Targeted at proteomics, the searched sub sequences are often tryptic peptide. Indexing by such peptides could have been possible, however it does not scale with large databases (SwissProt + Trembl).
Therefore, we propose the following approach, relying on the versatile [mongodb aggregation framework](http://docs.mongodb.org/manual/aggregation/):

   - during the loading process, sequence are cleaved at each `[KR]` positions and the list of four character C terminus characters are kept for indexing;
   - at search time, the eventual query sub sequences ending by `[KR]` are used to filter the proteins from the database;
   - a second pass filter is then applied to keep the proteins containing all the full sub sequences.




###More than JavaScript to hit the mongodb server
The same database get of course be used in other languages such as Scala

    def getByAcs(acs: List[String]): Future[List[Protein]] = {
      val query = BSONDocument("id" -> BSONDocument("$in" -> acs))
      coll.find(query)
          .cursor[Protein]
          .collect[List]()
    }

    implicit object ProteinReader extends BSONDocumentReader[Protein] {
      def read(doc: BSONDocument): Protein = {
        val id = doc.getAs[String]("id").get
        val sequence = doc.getAs[String]("sequence").get
        new Protein(id, sequence)
      }
    }

###Author
This tool was initiated by Alexandre Masselot (masselot.alexandre@gene.com)  within Genentech Bioinformatics & Computational Biology Department.
            
###License
The source code is distributed under a BSD license. Full description can be found in [LICENSE.txt](LICENSE.txt)
