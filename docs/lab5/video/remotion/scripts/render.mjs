import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(project,'../../../../output/lab5-video');mkdirSync(output,{recursive:true});
const result=spawnSync('npx',['remotion','render','BookingDemo',path.join(output,'booking-web-manager-lab5-remotion-v6-picture.mp4'),
  '--muted','--concurrency=2','--image-format=png','--crf=10'],{cwd:project,stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const finish=spawnSync(process.execPath,[path.join(project,'scripts/finish.mjs')],{cwd:project,stdio:'inherit'});
process.exit(finish.status??1);
