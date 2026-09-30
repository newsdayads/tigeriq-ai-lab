import fs from "node:fs/promises";

export const CLASSIFICATIONS = Object.freeze({
  KEEP_CURRENT: "KEEP_CURRENT",
  KEEP_BUT_FIX: "KEEP_BUT_FIX",
  LEGACY_DISABLED: "LEGACY_DISABLED",
  TEMP_ONE_SHOT: "TEMP_ONE_SHOT",
  DUPLICATE_SUPERSEDED: "DUPLICATE_SUPERSEDED",
  UNKNOWN_NEEDS_PROOF: "UNKNOWN_NEEDS_PROOF",
});

export const CLEANUP_POLICY = Object.freeze({
  destructiveExecutionAllowed: false,
  ownerApprovalRequiredForDelete: true,
  backupRequiredBeforeDelete: true,
  backupHashRequired: "SHA256",
});

const DELETE_CLASSES = new Set([
  CLASSIFICATIONS.LEGACY_DISABLED,
  CLASSIFICATIONS.TEMP_ONE_SHOT,
  CLASSIFICATIONS.DUPLICATE_SUPERSEDED,
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stateOf(task) {
  return String(task?.state ?? "").trim().toUpperCase();
}

function sourceRefs(task) {
  return asArray(task?.evidence?.sourceRefs)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function hasSourceProof(task) {
  return sourceRefs(task).length > 0;
}

function hasCurrentRuntimeProof(task) {
  return (
    task?.evidence?.currentRuntime === true &&
    Boolean(String(task?.runtimeOwner ?? "").trim()) &&
    hasSourceProof(task)
  );
}

function hasNoDependencyProof(task) {
  return (
    task?.evidence?.dependenciesNone === true &&
    task?.evidence?.dependenciesVerified === true
  );
}

function hasInactiveTriggerProof(task) {
  return (
    task?.evidence?.triggerInactive === true &&
    task?.evidence?.triggerVerified === true
  );
}

function hasBackupProof(task) {
  return (
    task?.evidence?.backupXmlExported === true &&
    task?.evidence?.backupPass === true &&
    Boolean(String(task?.evidence?.backupManifestSha256 ?? "").trim())
  );
}

export function classifyTask(task) {
  if (!task || typeof task !== "object") {
    return CLASSIFICATIONS.UNKNOWN_NEEDS_PROOF;
  }

  if (hasCurrentRuntimeProof(task)) {
    if (task.pathExists === false || task.evidence?.needsFix === true) {
      return CLASSIFICATIONS.KEEP_BUT_FIX;
    }
    return CLASSIFICATIONS.KEEP_CURRENT;
  }

  if (
    hasSourceProof(task) &&
    (Boolean(String(task?.evidence?.duplicateOf ?? "").trim()) ||
      Boolean(String(task?.evidence?.supersededBy ?? "").trim()))
  ) {
    return CLASSIFICATIONS.DUPLICATE_SUPERSEDED;
  }

  if (hasSourceProof(task) && task?.evidence?.temporaryOneShot === true) {
    return CLASSIFICATIONS.TEMP_ONE_SHOT;
  }

  if (
    stateOf(task) === "DISABLED" &&
    task?.evidence?.legacy === true &&
    hasSourceProof(task)
  ) {
    return CLASSIFICATIONS.LEGACY_DISABLED;
  }

  return CLASSIFICATIONS.UNKNOWN_NEEDS_PROOF;
}

function deleteEligibility(task, classification) {
  if (!DELETE_CLASSES.has(classification)) {
    return {
      eligible: false,
      blocker: "CLASSIFICATION_NOT_DELETE_CANDIDATE",
    };
  }

  if (hasCurrentRuntimeProof(task)) {
    return {
      eligible: false,
      blocker: "CURRENT_RUNTIME_PROOF_PRESENT",
    };
  }

  const state = stateOf(task);
  if (state === "RUNNING") {
    return {
      eligible: false,
      blocker: "TASK_RUNNING",
    };
  }

  if (state === "DISABLED") {
    return {
      eligible: true,
      blocker: null,
    };
  }

  if (!hasNoDependencyProof(task)) {
    return {
      eligible: false,
      blocker: "DEPENDENCY_NONE_NOT_PROVEN",
    };
  }

  if (!hasInactiveTriggerProof(task)) {
    return {
      eligible: false,
      blocker: "TRIGGER_INACTIVE_NOT_PROVEN",
    };
  }

  return {
    eligible: true,
    blocker: null,
  };
}

export function buildCleanupPlan(inventory) {
  if (!Array.isArray(inventory)) {
    throw new TypeError("inventory must be an array");
  }

  const classified = inventory.map((task) => {
    const classification = classifyTask(task);
    const deletion = deleteEligibility(task, classification);
    return {
      taskName: String(task?.taskName ?? ""),
      state: String(task?.state ?? ""),
      trigger: task?.trigger ?? null,
      action: task?.action ?? null,
      lastRun: task?.lastRun ?? null,
      lastResult: task?.lastResult ?? null,
      pathExists: task?.pathExists ?? null,
      runtimeOwner: task?.runtimeOwner ?? null,
      dependencies: asArray(task?.dependencies),
      classification,
      evidenceRefs: sourceRefs(task),
      deletionEligible: deletion.eligible,
      deletionBlocker: deletion.blocker,
      backupVerified: hasBackupProof(task),
    };
  });

  const allowlist = classified
    .filter((item) =>
      [CLASSIFICATIONS.KEEP_CURRENT, CLASSIFICATIONS.KEEP_BUT_FIX].includes(
        item.classification,
      ),
    )
    .map((item) => ({
      taskName: item.taskName,
      classification: item.classification,
      runtimeOwner: item.runtimeOwner,
      dependencies: item.dependencies,
      evidenceRefs: item.evidenceRefs,
    }));

  const backupCandidates = classified
    .filter((item) => item.deletionEligible)
    .map((item) => ({
      taskName: item.taskName,
      classification: item.classification,
      exportXml: true,
      sha256Manifest: true,
    }));

  const deleteProposal = classified
    .filter((item) => DELETE_CLASSES.has(item.classification))
    .map((item) => ({
      taskName: item.taskName,
      classification: item.classification,
      proposed: item.deletionEligible && item.backupVerified,
      blocker: !item.deletionEligible
        ? item.deletionBlocker
        : item.backupVerified
          ? null
          : "BACKUP_NOT_VERIFIED",
      ownerApprovalRequired: true,
      destructiveActionIncluded: false,
    }));

  return {
    policy: CLEANUP_POLICY,
    summary: {
      beforeCount: classified.length,
      allowlistCount: allowlist.length,
      backupCandidateCount: backupCandidates.length,
      deleteProposalCount: deleteProposal.filter((item) => item.proposed).length,
      unknownCount: classified.filter(
        (item) =>
          item.classification === CLASSIFICATIONS.UNKNOWN_NEEDS_PROOF,
      ).length,
    },
    classified,
    allowlist,
    backupPlan: {
      requiredBeforeDelete: true,
      format: "Scheduled Task XML",
      hash: "SHA256",
      candidates: backupCandidates,
    },
    deleteProposal: {
      ownerApprovalRequired: true,
      executionIncluded: false,
      candidates: deleteProposal,
    },
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write(
      "Usage: node task-scheduler-cleanup.mjs <inventory.json>\n",
    );
    process.exitCode = 2;
    return;
  }

  const raw = await fs.readFile(inputPath, "utf8");
  const inventory = JSON.parse(raw);
  const plan = buildCleanupPlan(inventory);
  process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll("\\", "/"))
) {
  main().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exitCode = 1;
  });
}
