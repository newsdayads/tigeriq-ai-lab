import { WEB_SNAPSHOT_SCHEMA } from './controller-client.js';

const now = '2026-09-02T16:20:00+07:00';
const earlier = '2026-09-02T15:40:00+07:00';
const mockProvenance = ref => ({ source_system:'web-preview-mock', source_ref:ref, source_version:'pr117-preview', observed_at:now, confidence:'high' });

export const MOCK_CONTROL_TOWER_PREVIEW = Object.freeze({
  goal_profiles:[{ goal_id:'GOAL-COMPANY-001', title:'Radar cơ hội kinh doanh TigerIQ', owner_ref:'OWNER-SEP', start_at:earlier, end_at:'2026-09-05T18:00:00+07:00', related_kpi_ids:['KPI-TRACE','KPI-TOP3','KPI-CLOSED-LOOP','KPI-PAID'], decision_ref:'MOCK-DECISION-COMPANY-001', updated_at:now }],
  kpis:[
    { kpi_id:'KPI-TRACE', name:'Độ truy vết bằng chứng', unit:'%', direction:'increase', baseline:0, target:100, warning_threshold:80, critical_threshold:60, status:'active', goal_ids:['GOAL-COMPANY-001'], process_ids:['PROC-OPPORTUNITY-RADAR'], updated_at:now },
    { kpi_id:'KPI-TOP3', name:'TOP 3 đủ hồ sơ', unit:'cơ hội', direction:'increase', baseline:0, target:3, warning_threshold:2, critical_threshold:1, status:'active', goal_ids:['GOAL-COMPANY-001'], process_ids:['PROC-OPPORTUNITY-RADAR'], updated_at:now },
    { kpi_id:'KPI-CLOSED-LOOP', name:'Vòng tự vận hành', unit:'gate', direction:'increase', baseline:0, target:8, warning_threshold:6, critical_threshold:4, status:'active', goal_ids:['GOAL-COMPANY-001'], process_ids:['PROC-OPPORTUNITY-RADAR'], updated_at:now },
    { kpi_id:'KPI-PAID', name:'Cam kết trả phí', unit:'lần', direction:'decrease', baseline:0, target:0, warning_threshold:0, critical_threshold:1, status:'active', goal_ids:['GOAL-COMPANY-001'], process_ids:[], updated_at:now },
  ],
  kpi_observations:[
    { observation_id:'OBS-TRACE-001', kpi_id:'KPI-TRACE', value:92, observed_at:now, provenance:mockProvenance('mock://kpi/trace'), evidence_refs:[] },
    { observation_id:'OBS-TOP3-001', kpi_id:'KPI-TOP3', value:2, observed_at:now, provenance:mockProvenance('mock://kpi/top3'), evidence_refs:[] },
    { observation_id:'OBS-CLOSED-001', kpi_id:'KPI-CLOSED-LOOP', value:6, observed_at:now, provenance:mockProvenance('mock://kpi/closed-loop'), evidence_refs:[] },
    { observation_id:'OBS-PAID-001', kpi_id:'KPI-PAID', value:0, observed_at:now, provenance:mockProvenance('mock://kpi/paid'), evidence_refs:[] },
  ],
  signals:[{ signal_id:'SIGNAL-MOCK-001', signal_type:'opportunity-radar', title:'Có nhóm cơ hội cần chấm fixed rubric', severity:'info', status:'consumed', dedupe_key:'mock-opportunity-radar-001', related_refs:[{entity_type:'goal',entity_id:'GOAL-COMPANY-001'}], provenance:mockProvenance('mock://signal/opportunity-radar'), created_at:earlier, updated_at:now }],
  processes:[{ process_id:'PROC-OPPORTUNITY-RADAR', name:'Radar cơ hội kinh doanh', department_id:'DEP-OPS', trigger_summary:'Owner hoặc tín hiệu cơ hội', input_contract:{signal_required:true}, completion_condition:'Có TOP 3 cơ hội đủ evidence và next experiment đảo ngược được.', required_permissions:['research.read'], approval_points:['paid_commitment','customer_contact'], risk_floor:'R1', kpi_ids:['KPI-TRACE','KPI-TOP3','KPI-CLOSED-LOOP'], status:'active', decision_ref:'MOCK-DECISION-PROCESS-001', updated_at:now }],
  missions:[
    { mission_id:'COMPANY-001', title:'Radar cơ hội kinh doanh TigerIQ', expected_outcome:'TOP 3 cơ hội evidence-traceable + reversible next experiment cho từng cơ hội.', goal_id:'GOAL-COMPANY-001', process_id:'PROC-OPPORTUNITY-RADAR', trigger_signal_ids:['SIGNAL-MOCK-001'], supervisor_employee_id:'EMP-CHIEF-001', participating_department_ids:['DEP-RESEARCH','DEP-PRODUCT','DEP-FINANCE','DEP-SALES'], risk_context:'R1 · research/proposal only', deadline:'2026-09-05T18:00:00+07:00', approved_budget_ceiling:null, decision_ref:'MOCK-DECISION-MISSION-001', status:'running', created_at:earlier, updated_at:now },
    { mission_id:'MISSION-WEB-147', title:'Company Control Tower Release Candidate', expected_outcome:'Company Control Tower map đúng Business State V2 và vượt code gates trước independent review.', process_id:'PROC-OPPORTUNITY-RADAR', trigger_signal_ids:[], supervisor_employee_id:'EMP-ENG-001', participating_department_ids:['DEP-ENG'], risk_context:'R1 · branch only', deadline:null, approved_budget_ceiling:null, decision_ref:'MOCK-DECISION-WEB-147', status:'running', created_at:earlier, updated_at:now },
  ],
  mission_job_refs:[
    { mission_id:'COMPANY-001', job_id:'MOCK-JOB-RESEARCH', relation:'execution', created_at:earlier },
    { mission_id:'COMPANY-001', job_id:'MOCK-JOB-SCORING', relation:'verification', created_at:earlier },
  ],
  departments:[
    { department_id:'DEP-RESEARCH', name:'Nghiên cứu', supervisor_employee_id:'EMP-CHIEF-001', status:'active', created_at:earlier, updated_at:now },
    { department_id:'DEP-PRODUCT', name:'Sản phẩm', supervisor_employee_id:'EMP-CHIEF-001', status:'active', created_at:earlier, updated_at:now },
    { department_id:'DEP-SALES', name:'Kinh doanh', supervisor_employee_id:'EMP-CHIEF-001', status:'active', created_at:earlier, updated_at:now },
    { department_id:'DEP-FINANCE', name:'Tài chính', supervisor_employee_id:'EMP-CHIEF-001', status:'active', created_at:earlier, updated_at:now },
    { department_id:'DEP-OPS', name:'Vận hành', supervisor_employee_id:'EMP-CHIEF-001', status:'active', created_at:earlier, updated_at:now },
    { department_id:'DEP-ENG', name:'Kỹ thuật', supervisor_employee_id:'EMP-ENG-001', status:'active', created_at:earlier, updated_at:now },
  ],
  employee_profiles:[
    { employee_id:'EMP-CHIEF-001', department_id:'DEP-OPS', business_role:'Chief of Staff AI', updated_at:now },
    { employee_id:'EMP-RESEARCH-001', department_id:'DEP-RESEARCH', supervisor_employee_id:'EMP-CHIEF-001', business_role:'Research & evidence', updated_at:now },
    { employee_id:'EMP-PRODUCT-001', department_id:'DEP-PRODUCT', supervisor_employee_id:'EMP-CHIEF-001', business_role:'Product fit & experiment design', updated_at:now },
    { employee_id:'EMP-SALES-001', department_id:'DEP-SALES', supervisor_employee_id:'EMP-CHIEF-001', business_role:'Monetization & customer-fit analysis', updated_at:now },
    { employee_id:'EMP-FIN-001', department_id:'DEP-FINANCE', supervisor_employee_id:'EMP-CHIEF-001', business_role:'Cost/ROI estimate only', updated_at:now },
    { employee_id:'EMP-ENG-001', department_id:'DEP-ENG', business_role:'Web Control / Company Control Tower', updated_at:now },
  ],
  autonomy_grants:[
    { autonomy_grant_id:'AUT-MOCK-CHIEF', employee_id:'EMP-CHIEF-001', scope_type:'mission', scope_ref:'COMPANY-001', level:'A2', status:'active', constraints:['Không paid commitment','Không customer contact'], valid_from:earlier, decision_ref:'MOCK-DECISION-AUT-CHIEF', created_at:earlier },
    { autonomy_grant_id:'AUT-MOCK-RESEARCH', employee_id:'EMP-RESEARCH-001', scope_type:'mission', scope_ref:'COMPANY-001', level:'A1', status:'active', constraints:['Research only'], valid_from:earlier, decision_ref:'MOCK-DECISION-AUT-RESEARCH', created_at:earlier },
    { autonomy_grant_id:'AUT-MOCK-WEB', employee_id:'EMP-ENG-001', scope_type:'mission', scope_ref:'MISSION-WEB-147', level:'A2', status:'active', constraints:['No MAIN/Production','No paid service'], valid_from:earlier, decision_ref:'MOCK-DECISION-AUT-WEB', created_at:earlier },
  ],
  exceptions:[{ exception_id:'EXC-MOCK-001', severity:'high', category:'owner_authority', summary:'Chọn hướng thử nghiệm sau TOP 3', impact:'Không chặn research; chặn customer contact hoặc paid experiment.', attempted_actions:['Chuẩn bị reversible next experiments','Giữ mọi paid/customer-contact action ngoài phạm vi'], proposed_action:'Sếp chọn 1 cơ hội để mở work order riêng nếu muốn thử nghiệm ngoài pilot.', required_owner_action:'Quyết định có mở work order thử nghiệm tiếp theo hay chỉ giữ ở mức proposal.', related_refs:[{entity_type:'mission',entity_id:'COMPANY-001'},{entity_type:'goal',entity_id:'GOAL-COMPANY-001'}], status:'awaiting_owner', created_at:earlier, updated_at:now }],
  outcomes:[
    { outcome_id:'OUT-MOCK-001', subject_ref:{entity_type:'mission',entity_id:'COMPANY-001'}, summary:'Mẫu UX: 2 cơ hội đã đạt rubric; đây không phải outcome live.', status:'recorded', achieved_at:now, kpi_observation_ids:['OBS-TOP3-001','OBS-TRACE-001'], evidence_refs:[], provenance:[mockProvenance('mock://outcome/company-001')], created_at:earlier, updated_at:now },
    { outcome_id:'OUT-MOCK-002', subject_ref:{entity_type:'mission',entity_id:'MISSION-WEB-147'}, summary:'Mẫu UX: Company Control Tower map Business State V2 trên branch.', status:'recorded', achieved_at:now, kpi_observation_ids:[], evidence_refs:[], provenance:[mockProvenance('mock://outcome/web-147')], created_at:earlier, updated_at:now },
  ],
});

export const MOCK_CONTROLLER_SNAPSHOT = Object.freeze({
  schemaVersion:WEB_SNAPSHOT_SCHEMA,
  generatedAt:now,
  source:{mode:'mock',authoritative:false,label:'DỮ LIỆU MẪU V2 · Business State V2 contract-shaped'},
  controller:{state:'unknown',transport:'mock',baseUrl:null,tailscale:'not-probed',database:'not-probed',lastSyncAt:null,contractState:'BUSINESS_STATE_V2_DESIGN_MAPPED'},
  company:{name:'TigerIQ AI Lab',version:'Company V2 Preview',phase:'WO-049 · Company Control Tower',operatingMode:'AI-native company · runtime local-first',currentObjective:'Goal → Signal → Mission → AI Employee → Verify → KPI/Outcome → CẦN SẾP khi có ngoại lệ',truthPolicy:'Mock luôn authoritative=false; Business State V2 live phải đến từ Controller projection và giữ provenance.',progress:{percent:0,label:'Không dùng progress kỹ thuật làm KPI công ty',note:'Technical only'},readiness:[],workforceSummary:{}},
  goals:[{goalId:'GOAL-COMPANY-001',objective:'Tạo TOP 3 cơ hội kinh doanh có căn cứ, phù hợp nguồn lực TigerIQ và có bước thử nghiệm đảo ngược được.',priority:'P0',status:'running',constraints:['Không phát sinh paid commitment','Không liên hệ khách hàng trong pilot','Material claims cần source ref'],isMock:true}],
  departments:[
    {departmentId:'DEP-RESEARCH',name:'Nghiên cứu',isMock:true},{departmentId:'DEP-PRODUCT',name:'Sản phẩm',isMock:true},{departmentId:'DEP-SALES',name:'Kinh doanh',isMock:true},{departmentId:'DEP-FINANCE',name:'Tài chính',isMock:true},{departmentId:'DEP-OPS',name:'Vận hành',isMock:true},{departmentId:'DEP-ENG',name:'Kỹ thuật',isMock:true},
  ],
  employees:[
    {employeeId:'EMP-CHIEF-001',displayName:'Chief of Staff AI',availability:'unknown',provider:'unassigned',model:'Không gắn danh tính với model',capabilities:['mission-summary','exception-routing'],lastHeartbeatAt:null,isMock:true},
    {employeeId:'EMP-RESEARCH-001',displayName:'AI Researcher',availability:'unknown',provider:'gemini',model:'Chưa xác nhận runtime',capabilities:['research','source-trace'],lastHeartbeatAt:null,isMock:true},
    {employeeId:'EMP-PRODUCT-001',displayName:'AI Product Analyst',availability:'unknown',provider:'unassigned',model:'Chưa gán',capabilities:['product-analysis'],lastHeartbeatAt:null,isMock:true},
    {employeeId:'EMP-SALES-001',displayName:'AI Sales Analyst',availability:'unknown',provider:'unassigned',model:'Chưa gán',capabilities:['sales-analysis'],lastHeartbeatAt:null,isMock:true},
    {employeeId:'EMP-FIN-001',displayName:'AI Finance Analyst',availability:'unknown',provider:'unassigned',model:'Chưa gán',capabilities:['finance-estimate'],lastHeartbeatAt:null,isMock:true},
    {employeeId:'EMP-ENG-001',displayName:'AI Web Engineer',availability:'unknown',provider:'openai',model:'Chat runtime không phải employee identity',capabilities:['web-ui','controller-client'],lastHeartbeatAt:null,isMock:true},
  ],
  jobs:[
    {jobId:'MOCK-JOB-RESEARCH',objective:'Thu thập và chuẩn hóa evidence cho COMPANY-001.',department:'Nghiên cứu',priority:'P0',stage:'RUNNING',assignedEmployeeId:'EMP-RESEARCH-001',attempts:1,maxAttempts:2,progress:62,requiredCapabilities:['research','source-trace'],blocker:null,recovery:{strategy:'bounded-retry',nextEligibleAt:null},isMock:true},
    {jobId:'MOCK-JOB-SCORING',objective:'Chấm TOP 3 bằng fixed rubric.',department:'Vận hành',priority:'P1',stage:'QUEUED',assignedEmployeeId:'EMP-CHIEF-001',attempts:0,maxAttempts:2,progress:20,requiredCapabilities:['mission-summary'],blocker:null,recovery:{strategy:'wait-dependency',nextEligibleAt:null},isMock:true},
    {jobId:'MOCK-JOB-BLOCKED',objective:'Mẫu lỗi runtime cho Technical Operations.',department:'Kỹ thuật',priority:'P2',stage:'BLOCKED',assignedEmployeeId:'EMP-ENG-001',attempts:1,maxAttempts:2,progress:35,requiredCapabilities:['controller-client'],blocker:{code:'MOCK_HEARTBEAT_MISSING',message:'Không có heartbeat thật; chỉ là record mẫu.',retriable:true},recovery:{strategy:'wait-heartbeat',nextEligibleAt:null},isMock:true},
  ],
  devices:[{nodeId:'PC01',displayName:'PC01',kind:'local',platform:'Windows',status:'unknown',tailscaleIp:null,controllerPort:8790,leaseState:'unknown',lastHeartbeatAt:null,isMock:true},{nodeId:'PHONE-EMP-001',displayName:'Điện thoại AI Employee',kind:'android',platform:'Android',status:'unknown',tailscaleIp:null,controllerPort:null,leaseState:'unknown',lastHeartbeatAt:null,isMock:true}],
  providers:[{providerId:'gemini',displayName:'Gemini API',role:'Provider dự kiến cho worker điện thoại',health:'unknown',billingMode:'free-first',credentialPresent:'unknown',quota:null,models:['Chờ runtime'],successRate:null,latencyP50Ms:null,isMock:true},{providerId:'ollama',displayName:'Ollama local',role:'AI local / dự phòng',health:'unknown',billingMode:'local-zero-cost',credentialPresent:'not-required',quota:null,models:['Chưa quét PC01'],successRate:null,latencyP50Ms:null,isMock:true}],
  prompts:[{promptId:'PROMPT-COMPANY-001',name:'COMPANY-001 Research',purpose:'Research có source trace và không vượt R1.',activeVersion:'v1-preview',versions:[{version:'v1-preview',status:'DRAFT',content:'Research trong phạm vi pilot; không paid/customer contact; material facts cần source refs.',metrics:{runs:0,pass:0,fail:0},isMock:true}],isMock:true}],
  results:[{resultId:'MOCK-RESULT-001',jobId:'MOCK-JOB-RESEARCH',employeeId:'EMP-RESEARCH-001',status:'PREVIEW_SAMPLE',conclusion:'Mẫu kỹ thuật; không phải Business Outcome live.',provider:'gemini',model:'unknown',evidence:{state:'PENDING',refs:[]},review:{state:'PENDING'},judge:{state:'PENDING'},artifacts:[],isMock:true}],
  checks:[{checkId:'CHECK-MOCK-TRUTH',name:'Mock truth boundary',jobId:'MOCK-JOB-RESEARCH',state:'PASS',detail:'Dữ liệu mẫu authoritative=false.',at:now,isMock:true}],
  activity:[{eventId:'ACT-MOCK-001',at:now,type:'PREVIEW',message:'Company Control Tower dùng Business State V2 mock không-authoritative.',isMock:true}],
  build:{sha:null,ci:'unknown',preview:'unknown',source:'not-probed'},
  leases:[],
});
