# WO-196 Updater Self-test Root Cause

Observed physical PC01 repair output: Command Center V3 install completed and reported READY at exact commit `695df10ca3b302a30e11cf89579f28a3ab55ef89`, but the subsequent updater SYSTEM self-test timed out after 45 seconds.

The failure is isolated to the updater validation gate. Do not classify the V3 install itself as failed. Do not request another Owner PowerShell/CMD run until PC01 task/process state is re-audited.
