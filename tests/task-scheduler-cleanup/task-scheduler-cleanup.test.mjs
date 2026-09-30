import { describe, expect, it } from "vitest";
import {
  CLASSIFICATIONS,
  CLEANUP_POLICY,
  buildCleanupPlan,
  classifyTask,
} from "../../scripts/task-scheduler-cleanup/task-scheduler-cleanup.mjs";

const provenCurrent = {
  taskName: "TigerIQ Core 24x7",
  state: "Ready",
  pathExists: true,
  runtimeOwner: "TigerIQ Core",
  dependencies: ["8795"],
  evidence: {
    currentRuntime: true,
    sourceRefs: ["docs/CURRENT_STATE.md#core"],
  },
};

describe("task scheduler cleanup planner", () => {
  it("keeps a current task only when current-runtime evidence is present", () => {
    expect(classifyTask(provenCurrent)).toBe(CLASSIFICATIONS.KEEP_CURRENT);
    expect(
      classifyTask({
        taskName: "TigerIQ Core 24x7",
        state: "Ready",
        pathExists: true,
      }),
    ).toBe(CLASSIFICATIONS.UNKNOWN_NEEDS_PROOF);
  });

  it("classifies current runtime with broken path as KEEP_BUT_FIX", () => {
    expect(classifyTask({ ...provenCurrent, pathExists: false })).toBe(
      CLASSIFICATIONS.KEEP_BUT_FIX,
    );
  });

  it("requires source references for delete classifications", () => {
    expect(
      classifyTask({
        taskName: "Old Worker",
        state: "Disabled",
        evidence: { supersededBy: "New Worker" },
      }),
    ).toBe(CLASSIFICATIONS.UNKNOWN_NEEDS_PROOF);
  });

  it("puts evidenced disabled legacy task into backup plan but not delete proposal before backup PASS", () => {
    const plan = buildCleanupPlan([
      {
        taskName: "TigerIQ Temp 820",
        state: "Disabled",
        pathExists: false,
        evidence: {
          legacy: true,
          sourceRefs: ["issue:#2475"],
        },
      },
    ]);

    expect(plan.classified[0].classification).toBe(
      CLASSIFICATIONS.LEGACY_DISABLED,
    );
    expect(plan.classified[0].deletionEligible).toBe(true);
    expect(plan.backupPlan.candidates).toHaveLength(1);
    expect(plan.deleteProposal.candidates[0]).toMatchObject({
      proposed: false,
      blocker: "BACKUP_NOT_VERIFIED",
      ownerApprovalRequired: true,
      destructiveActionIncluded: false,
    });
  });

  it("allows delete proposal only after XML backup and SHA256 manifest are verified", () => {
    const plan = buildCleanupPlan([
      {
        taskName: "TigerIQ Temp 820",
        state: "Disabled",
        evidence: {
          legacy: true,
          sourceRefs: ["issue:#2475"],
          backupXmlExported: true,
          backupPass: true,
          backupManifestSha256: "abc123",
        },
      },
    ]);

    expect(plan.deleteProposal.candidates[0]).toMatchObject({
      proposed: true,
      blocker: null,
      ownerApprovalRequired: true,
      destructiveActionIncluded: false,
    });
  });

  it("blocks a running superseded task from delete proposal", () => {
    const plan = buildCleanupPlan([
      {
        taskName: "Old Worker",
        state: "Running",
        evidence: {
          supersededBy: "New Worker",
          sourceRefs: ["issue:#2475"],
        },
      },
    ]);

    expect(plan.classified[0].classification).toBe(
      CLASSIFICATIONS.DUPLICATE_SUPERSEDED,
    );
    expect(plan.classified[0].deletionEligible).toBe(false);
    expect(plan.classified[0].deletionBlocker).toBe("TASK_RUNNING");
  });

  it("requires dependency-none and inactive-trigger proof for non-disabled candidates", () => {
    const base = {
      taskName: "Old Ready Worker",
      state: "Ready",
      evidence: {
        duplicateOf: "Current Worker",
        sourceRefs: ["issue:#2475"],
      },
    };

    const unproven = buildCleanupPlan([base]);
    expect(unproven.classified[0].deletionEligible).toBe(false);
    expect(unproven.classified[0].deletionBlocker).toBe(
      "DEPENDENCY_NONE_NOT_PROVEN",
    );

    const proven = buildCleanupPlan([
      {
        ...base,
        evidence: {
          ...base.evidence,
          dependenciesNone: true,
          dependenciesVerified: true,
          triggerInactive: true,
          triggerVerified: true,
        },
      },
    ]);

    expect(proven.classified[0].deletionEligible).toBe(true);
  });

  it("builds canonical allowlist only from evidenced current runtime tasks", () => {
    const plan = buildCleanupPlan([
      provenCurrent,
      {
        taskName: "Looks Current By Name Only",
        state: "Ready",
      },
    ]);

    expect(plan.allowlist).toEqual([
      {
        taskName: "TigerIQ Core 24x7",
        classification: CLASSIFICATIONS.KEEP_CURRENT,
        runtimeOwner: "TigerIQ Core",
        dependencies: ["8795"],
        evidenceRefs: ["docs/CURRENT_STATE.md#core"],
      },
    ]);
    expect(plan.summary.unknownCount).toBe(1);
  });

  it("never authorizes destructive execution in generated plans", () => {
    const plan = buildCleanupPlan([
      {
        taskName: "Disposable",
        state: "Disabled",
        evidence: {
          temporaryOneShot: true,
          sourceRefs: ["issue:#2475"],
          backupXmlExported: true,
          backupPass: true,
          backupManifestSha256: "abc123",
        },
      },
    ]);

    expect(CLEANUP_POLICY.destructiveExecutionAllowed).toBe(false);
    expect(plan.policy.ownerApprovalRequiredForDelete).toBe(true);
    expect(plan.deleteProposal.executionIncluded).toBe(false);
    expect(
      plan.deleteProposal.candidates.every(
        (item) => item.ownerApprovalRequired && !item.destructiveActionIncluded,
      ),
    ).toBe(true);
  });

  it("rejects non-array inventory", () => {
    expect(() => buildCleanupPlan({})).toThrow(/inventory must be an array/);
  });
});
