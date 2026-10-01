This exploratory capture is INVALID as revision evidence: the inspector attached
to the baseline preview already occupying port 4177 before its own preview
reported startup failure. The pixels show the old baseline, although a later
local source hash could describe the edited workspace. Do not use these images
for a before/after comparison or claim they are the second revision.

The inspector now requires its own preview's startup URL and compares the served
HTML build entry against the local build before opening a browser. The corrected
run uses a separate port and writes `after-second-verified/`.
