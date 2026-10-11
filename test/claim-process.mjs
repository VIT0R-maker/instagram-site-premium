import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { Store, invokeClaudeOnce } from '../src/store.mjs';
const store=new Store(process.argv[2]);
try{await invokeClaudeOnce(store,'process-race',async()=>{appendFileSync(path.join(process.argv[2],'requests.txt'),'provider-request\n');await new Promise(r=>setTimeout(r,40));return {text:'saved',status:200,requestId:'mock'};});}
catch(e){if(e.code!=='CLAUDE_AMBIGUOUS')throw e;}
finally{store.close();}
