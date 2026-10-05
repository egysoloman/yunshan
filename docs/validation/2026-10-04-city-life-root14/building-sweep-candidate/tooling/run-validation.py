import pathlib, subprocess, sys

source = pathlib.Path(__file__).parent/'source'
commands=[['node','--import','tsx','--test','--test-isolation=none','tests/upright-cylinder-sweep.test.ts'],
          ['node','node_modules/typescript/bin/tsc','--noEmit']]
for command in commands:
    result=subprocess.run(command,cwd=source)
    print({'argv':command,'exitCode':result.returncode},flush=True)
    if result.returncode:sys.exit(result.returncode)
