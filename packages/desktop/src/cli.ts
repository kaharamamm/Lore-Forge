// The `lore` command line as shipped in the app: resources/bin/lore runs this bundle with ELECTRON_RUN_AS_NODE=1.
import { run } from '../../cli/src/main.ts';

void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
