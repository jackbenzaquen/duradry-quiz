import fs from 'node:fs/promises';import {getDb} from '../lib/db.mjs';import {importLinks} from '../lib/legacy-csv.mjs';
const [file,apply]=process.argv.slice(2);if(!file)throw Error('Usage: SESSION_LINKS_JSON [--apply]');const links=JSON.parse(await fs.readFile(file));
if(apply!=='--apply'){console.log(JSON.stringify({mode:'dry-run',exact_links:links.length}));process.exit(0);}await importLinks(getDb(),links);console.log('Imported '+links.length+' exact response links; original records remain preserved.');
