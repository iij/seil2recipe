const colors = require('colors');
const fs = require('fs');
const seil2recipe = require('./seil2recipe');

if (process.argv.length < 3) {
    console.log('usage: node main.js [-v] seil.txt');
    process.exit(1);
}

var seilconfigfile;
var verbose;

if (process.argv[2] == '-v') {
    verbose = true;
    seilconfigfile = process.argv[3];
} else {
    verbose = false;
    seilconfigfile = process.argv[2];
}

const txt = fs.readFileSync(seilconfigfile, {encoding: "utf-8"});
const s2r = new seil2recipe.Converter(txt, 'x4');

if (!verbose) {
    console.log(s2r.recipe_config);
} else {
    s2r.conversions.forEach((conv, idx) => {
        console.log(`${idx + 1}: `.gray + conv.seil_line.blue);

        conv.errors.forEach(e => {
            var msg = '';
            if (e.type == 'deprecated') {
                msg = e.message.grey;
            } else if (e.type == 'notsupported') {
                msg = e.message.yellow;
            } else {
                msg = e.message.red;
            }
            console.log(msg);

            if (e.error) {
                console.log(e.error.stack.magenta);
            }
        });

        conv.recipe.forEach(rl => {
            console.log('\t' + rl);
        });
    })
}
