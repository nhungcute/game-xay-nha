import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results/g1',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await page.goto('http://127.0.0.1:5173/?debug=1&test=1');
await page.waitForTimeout(7000);
console.log(await page.title());
console.log(await page.locator('body').innerText());
const metrics=await page.evaluate(()=>window.__debug?.metrics());
await page.screenshot({path:'test-results/g1/initial.png'});
await writeFile('test-results/g1/smoke.json',JSON.stringify({metrics,errors},null,2));
console.log(JSON.stringify({metrics,errors}));
await browser.close();
if(errors.length||!metrics)process.exitCode=1;
