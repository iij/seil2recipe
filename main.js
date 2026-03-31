import fs from 'node:fs';
import { styleText } from 'node:util';
import { Converter } from './seil2recipe.js';

if (process.argv.length < 3) {
    console.log('usage: node main.js [-v] seil.txt');
    process.exit(1);
}

var seilconfigfile;
var model = 'x4';
var verbose = false;

let args = process.argv.slice(2);
while (args[0][0] == '-') {
    let arg = args.shift();
    if (arg == '-v') {
        verbose = true;
    } else if (arg == '-m') {
        model = args.shift();
    }
}
seilconfigfile = args[0];

const txt = fs.readFileSync(seilconfigfile, {encoding: "utf-8"});
const s2r = new Converter(txt, model);

if (!verbose) {
    console.log(s2r.recipe_config);
} else {
    s2r.conversions.forEach((conv, idx) => {
        console.log(styleText('gray', `${idx + 1}: `) +
            styleText('blue', conv.seil_line));

        conv.errors.forEach(e => {
            var msg = '';
            if (e.type == 'deprecated') {
                msg = styleText('grey', e.message);
            } else if (e.type == 'notsupported') {
                msg = styleText('yellow', e.message);
            } else {
                msg = styleText('red', e.message);
            }
            console.log(msg);

            if (e.error) {
                console.log(styleText('magenta', e.error.stack));
            }
        });

        conv.recipe.forEach(rl => {
            console.log('\t' + rl);
        });
    })
}
