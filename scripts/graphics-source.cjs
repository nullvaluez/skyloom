const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
module.exports=function graphicsSource(){
 const hash=crypto.createHash('sha256');
 function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else if(/\.(js|jsx|mjs|json)$/.test(p)){hash.update(p.replaceAll('\\','/'));hash.update(fs.readFileSync(p));}}}
 for(const dir of ['app','components','lib','stores'])walk(dir);
 const gitOptions={encoding:'utf8',stdio:['ignore','pipe','ignore']};
 return {commit:execFileSync('git',['rev-parse','HEAD'],gitOptions).trim(),sourceSha256:hash.digest('hex'),workingTree:execFileSync('git',['diff','HEAD','--name-only'],gitOptions).trim()?'modified':'clean'};
};
