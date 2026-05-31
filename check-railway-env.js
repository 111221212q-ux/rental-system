process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const http = require('http');
const data = JSON.stringify({query:'{ variables(projectId: \"4c05405c-ab1c-4ccd-a708-cd44b87d95ad\", environmentId: \"31b9f689-6e4d-4d7f-ad04-d475f06b5a13\", serviceId: \"85d5f3e2-8bb4-4722-aaf7-8b0f43e09f4f\") { name, value } }'});
const opts = {host:'127.0.0.1',port:7892,method:'POST',path:'https://backboard.railway.app/graphql/v2',headers:{'Authorization':'Bearer e898cbae-af81-434c-b901-5007170d0ce9','Content-Type':'application/json','Host':'backboard.railway.app'}};
const req = http.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{const j=JSON.parse(d);(j.data?.variables||[]).filter(v=>v.name.includes('MONGODB')||v.name.includes('JWT')).forEach(v=>console.log(v.name,'=',v.value))})});
req.write(data);req.end();
