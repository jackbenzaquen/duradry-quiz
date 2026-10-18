import fs from 'node:fs/promises';
import {getDb} from '../lib/db.mjs';
import {registerConfig} from '../lib/config.mjs';
const file=process.argv[2];if(!file)throw Error('Pass a reviewed native quiz configuration JSON file');
const result=await registerConfig(getDb(),JSON.parse(await fs.readFile(file,'utf8')));console.log('Registered '+result.id+' version '+result.version);
