import { before, beforeEach, afterEach, after } from 'node:test';
import { writeFileSync, appendFileSync } from 'node:fs';
const starts=new Map(),file=new URL('./world-save-progress.jsonl',import.meta.url);
const record=data=>appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...data})+'\n');
before(()=>{writeFileSync(file,'');record({event:'run-start',pid:process.pid,cwd:process.cwd(),command:process.execArgv});});
beforeEach(ctx=>{starts.set(ctx.name,performance.now());record({event:'case-start',name:ctx.name});});
afterEach(ctx=>record({event:'case-finished',name:ctx.name,durationMs:performance.now()-starts.get(ctx.name)}));
after(()=>record({event:'run-finished'}));
