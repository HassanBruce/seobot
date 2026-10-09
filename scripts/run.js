// npm run audit | plan | write   (or: node scripts/run.js report)
import * as jobs from '../src/jobs.js';

const cmd = process.argv[2];
try {
  if (cmd === 'audit') {
    const a = await jobs.audit();
    console.log(`${a.pages} pages · high ${a.counts.high} · medium ${a.counts.medium} · low ${a.counts.low} · broken links ${a.broken.length}`);
    for (const i of a.issues.filter(x => x.severity === 'high').slice(0, 20)) console.log(`  [high] ${i.msg} — ${i.url}`);
  } else if (cmd === 'plan') {
    console.log(`Added ${await jobs.plan()} ideas.`);
  } else if (cmd === 'write') {
    console.log(`Draft #${await jobs.writeNext()} ready. Dashboard pe review karo.`);
  } else if (cmd === 'report') {
    console.log(await jobs.weeklyReport());
  } else {
    console.log('Usage: node scripts/run.js audit|plan|write|report');
  }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}
