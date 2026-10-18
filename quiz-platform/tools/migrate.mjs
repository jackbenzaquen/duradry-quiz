import fs from 'node:fs/promises';
import {getDb} from '../lib/db.mjs';
const sql=await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await getDb().query(statement);
console.log('Database tables and indexes are ready.');
