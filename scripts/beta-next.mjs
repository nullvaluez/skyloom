import {spawn} from 'node:child_process';
const command=process.argv[2]||'build';
if(!['build','start'].includes(command))throw Error('Use build or start');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',command,...command==='build'?['--webpack']:['-p',process.env.PORT||'3094']],{stdio:'inherit',env:{...process.env,FLY_BUILD_DIR:'.next-explorer',NEXT_TELEMETRY_DISABLED:'1'}});
child.on('exit',code=>{process.exitCode=code??1;});
