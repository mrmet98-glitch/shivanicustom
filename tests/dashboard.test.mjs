import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('dashboard separates archived, pending and declined projects for both roles',async()=>{
  const app={innerHTML:''},nodes=new Map();
  const document={querySelector(selector){if(selector==='#app')return app;if(!nodes.has(selector))nodes.set(selector,{addEventListener(){}});return nodes.get(selector)},querySelectorAll(){return []}};
  const context=vm.createContext({document,window:{addEventListener(){}},location:{hash:''},Intl,Date});
  vm.runInContext(await readFile(new URL('../public/app.js',import.meta.url),'utf8'),context);
  vm.runInContext(`state.projects=[
    {id:'active',name:'Active example',status:'Project Received',acceptance_status:'accepted',archived:0},
    {id:'done',name:'Completed example',status:'Delivered',acceptance_status:'accepted',archived:0},
    {id:'archive',name:'Archived example',status:'Delivered',acceptance_status:'accepted',archived:1},
    {id:'pending',name:'Pending example',status:'Project Received',acceptance_status:'pending',archived:0},
    {id:'declined',name:'Declined example',status:'Project Received',acceptance_status:'declined',archived:0}
  ];`,context);
  for(const role of ['admin','customer']){
    vm.runInContext(`state.user={role:'${role}',display_name:'Test'};`,context);
    for(const [list,id]of Object.entries({ongoing:'active',completed:'done',archived:'archive',pending:'pending',declined:'declined'})){
      vm.runInContext(`state.projectList='${list}';renderDashboardContent();`,context);
      assert.match(app.innerHTML,new RegExp(`data-project="${id}"`));
      for(const other of ['active','done','archive','pending','declined'].filter(x=>x!==id))assert.ok(!app.innerHTML.includes(`data-project="${other}"`));
    }
    assert.match(app.innerHTML,/Archived Projects/);assert.match(app.innerHTML,/Pending Acceptance/);
    assert.match(app.innerHTML,role==='customer'?/Submit Project/:/New Project/);
  }
});
