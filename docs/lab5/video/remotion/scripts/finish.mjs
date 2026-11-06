import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(project,'../../../../output/lab5-video');mkdirSync(output,{recursive:true});
const data=JSON.parse(readFileSync(path.join(project,'src/timeline.json'),'utf8'));
const picture=path.join(output,'booking-web-manager-lab5-remotion-v6-picture.mp4');
const listing=path.join(output,'remotion-v6-audio.ffconcat');
writeFileSync(listing,'ffconcat version 1.0\n'+data.chapters.map(c=>`file '${path.join(project,'public/audio',c.audio_file).replaceAll("'","'\\''")}'`).join('\n')+'\n');
const final=path.join(output,'booking-web-manager-lab5-remotion-v6.mp4');const temporary=path.join(output,'booking-web-manager-lab5-remotion-v6.finishing.mp4');
const args=['-v','warning','-y','-i',picture,'-f','concat','-safe','0','-i',listing,'-map','0:v','-map','1:a',
 '-c:v','libx264','-preset','fast','-threads','4','-b:v','10M','-minrate','10M','-maxrate','10M','-bufsize','20M','-x264-params','nal-hrd=cbr:force-cfr=1','-g','60','-pix_fmt','yuv420p',
 '-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-b:a','192k','-ar','48000','-t',String(data.duration),'-movflags','+faststart',temporary];
const done=spawnSync('ffmpeg',args,{stdio:'inherit'});if(done.status!==0)process.exit(done.status??1);renameSync(temporary,final);
console.log('Finished v6:',final,data.duration,'seconds; target video bitrate10 Mbps');
