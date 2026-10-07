# ROOT26 complete evidence chunks

Every chunk of every group is required. Parts contain disjoint complete original
files under their complete archive names; no path prefix or failure evidence is
truncated. Do not treat a first part or a partial run as the complete delivery.

Only index.json with status complete declares success. It lists every ZIP,
member, original SHA-256/byte count, member manifest, and generated artifact hash.
source-before.json maps all included originals before packing; source-after.json
verifies all original files again after every ZIP has been written and read back.
Each ZIP's decompressed bytes and CRC were checked against the before map.

Raw chunks are at most 70 MiB, every ZIP is strictly below 90 MiB, and every
generated file is strictly below 100 MiB. ZIP_DEFLATED uses compression level 6.
Original gzip/ZIP files remain complete original bytes inside their ZIP members.

Source symlinks and special files are rejected. Regular node_modules and .git
directories are deliberately skipped and listed in the index. Explicit sources
inside those directories are rejected. Empty groups produce one explicit empty
ZIP. All output files use exclusive creation; existing destinations are rejected.

If failure.json exists, the run failed and any emitted chunks are incomplete.
The packer never uploads, imports application code, collects process environment,
executes tests/builds, or runs subprocesses. The operator supplies only the exact
authorized original sources in the JSON plan.
