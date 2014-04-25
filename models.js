exports.models = {
    "Protein" : {
        "id" : "Protein",
        "properties" : {
            "id" : {
                "type" : "string",
                "description":'uniprot ID field'
            },
            "accessionCodes" : {
                "type" : "list[string]",
                'description': 'list of AC',
                'notes':'id is repeated here'
            },
            "isoformOf" :{
                'type': 'string',
                'description' : 'id of the parental isoform',
                'notes': 'can be itself'               
            },
            "sequence" :{
                'type': 'string',
                'description' : 'amino acids sequence'
            },
            'OS':{
                'type':'string',
                'description': 'species'
            },
            'OC':{
                'type':'string',
                'description':'taxonomy simplified hierarchy'
            }
        }
    },
}; 