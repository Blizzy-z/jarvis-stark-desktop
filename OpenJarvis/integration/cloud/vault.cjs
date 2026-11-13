const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Windows encrypts the credential vault for the current Windows user.
function dpapi(value, decrypt = false) {
  const action = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $out=[Security.Cryptography.ProtectedData]::${action}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($out))`;
  const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {input:Buffer.from(value).toString('base64'),encoding:'utf8',windowsHide:true});
  if(result.status !== 0) throw Error('Windows credential protection failed.');
  return Buffer.from(result.stdout.trim(),'base64');
}
function vault(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'accounts.dpapi');
  return {
    read(){return fs.existsSync(file)?JSON.parse(dpapi(fs.readFileSync(file),true).toString()):null;},
    write(data){const temp=file+'.tmp';fs.writeFileSync(temp,dpapi(JSON.stringify(data)));fs.renameSync(temp,file);}
  };
}
module.exports={vault};
