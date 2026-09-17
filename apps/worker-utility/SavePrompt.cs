namespace TigerIQ.WorkerUtility;

internal static class SavePrompt
{
    public static string Build(string token, string workerId, DateTimeOffset dispatchedAt)
        => string.Join('\n', new[]
        {
            "lưu", "",
            "Đây là lệnh CHỐT PHIÊN BỀN VỮNG của TigerIQ. Rà toàn bộ chat hiện tại; đối chiếu Nguồn Sự Thật động để chống trùng; cập nhật issue/Work Order/state hiện có với trạng thái thật, trọng tâm, quyết định mới, việc đã xong, việc còn dở, blocker/chờ/quyền cần thiết, bước tiếp theo và evidence/ref. Đọc lại để xác minh việc ghi đã thành công. Chỉ sau khi đã xác minh, thêm đúng 01 comment biên nhận vào GitHub Issue #788. Không ghi secret/credential/password/token hay dữ liệu riêng tư. Thay mọi placeholder bằng giá trị thật. Nếu không xác minh được, KHÔNG tạo biên nhận DURABLE và báo SAVE_NOT_DURABLE.",
            "", "TIGERIQ_SAVE_RECEIPT_V1",
            $"TIGERIQ_SAVE_TOKEN={token}",
            $"TIGERIQ_SAVE_WORKER={workerId}",
            $"TIGERIQ_SAVE_DISPATCHED_AT={dispatchedAt:O}",
            "TIGERIQ_SAVE_STATUS=DURABLE",
            "TIGERIQ_SAVE_REF=<URL GitHub checkpoint>",
            "TIGERIQ_SAVE_STATE=<trạng thái thật>",
            "TIGERIQ_SAVE_FOCUS=<trọng tâm hiện tại>",
            "TIGERIQ_SAVE_DECISIONS=<quyết định mới hoặc NONE>",
            "TIGERIQ_SAVE_DONE=<việc đã hoàn tất hoặc NONE>",
            "TIGERIQ_SAVE_PENDING=<việc còn dở hoặc NONE>",
            "TIGERIQ_SAVE_BLOCKERS=<blocker/chờ/quyền cần thiết hoặc NONE>",
            "TIGERIQ_SAVE_NEXT=<bước tiếp theo>",
            "TIGERIQ_SAVE_EVIDENCE=<evidence/ref quan trọng>"
        });
}
