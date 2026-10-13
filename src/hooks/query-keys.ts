// Centralized query key factory so mutations know exactly what to invalidate.
export const queryKeys = {
  patients: {
    all: ["patients"] as const,
    list: (params: unknown) => ["patients", "list", params] as const,
    detail: (id: string) => ["patients", "detail", id] as const,
    timeline: (id: string) => ["patients", "timeline", id] as const,
  },
  doctors: {
    all: ["doctors"] as const,
    list: (params: unknown) => ["doctors", "list", params] as const,
    detail: (id: string) => ["doctors", "detail", id] as const,
  },
  staff: {
    all: ["staff"] as const,
    list: (params: unknown) => ["staff", "list", params] as const,
    detail: (id: string) => ["staff", "detail", id] as const,
  },
  appointments: {
    all: ["appointments"] as const,
    list: (params: unknown) => ["appointments", "list", params] as const,
    detail: (id: string) => ["appointments", "detail", id] as const,
    today: (branchId?: string) => ["appointments", "today", branchId] as const,
    waitingRoom: (branchId?: string) => ["appointments", "waiting-room", branchId] as const,
  },
  consultations: {
    all: ["consultations"] as const,
    list: (params: unknown) => ["consultations", "list", params] as const,
    detail: (id: string) => ["consultations", "detail", id] as const,
  },
  prescriptions: {
    all: ["prescriptions"] as const,
    list: (params: unknown) => ["prescriptions", "list", params] as const,
    detail: (id: string) => ["prescriptions", "detail", id] as const,
  },
  reports: {
    all: ["reports"] as const,
    list: (params: unknown) => ["reports", "list", params] as const,
    detail: (id: string) => ["reports", "detail", id] as const,
  },
  documents: {
    all: ["documents"] as const,
    list: (params: unknown) => ["documents", "list", params] as const,
  },
  inventory: {
    all: ["inventory"] as const,
    list: (params: unknown) => ["inventory", "list", params] as const,
    detail: (id: string) => ["inventory", "detail", id] as const,
    summary: ["inventory", "summary"] as const,
  },
  billing: {
    invoicesAll: ["invoices"] as const,
    invoicesList: (params: unknown) => ["invoices", "list", params] as const,
    invoiceDetail: (id: string) => ["invoices", "detail", id] as const,
    paymentsList: (params: unknown) => ["payments", "list", params] as const,
    expensesList: (params: unknown) => ["expenses", "list", params] as const,
    summary: ["billing", "summary"] as const,
  },
  notifications: {
    list: (params: unknown) => ["notifications", "list", params] as const,
    unreadCount: (role?: string, patientId?: string) => ["notifications", "unread", role, patientId] as const,
  },
  auditLog: {
    list: (params: unknown) => ["audit-log", "list", params] as const,
  },
  analytics: {
    kpis: ["analytics", "kpis"] as const,
    kpisForBranch: (branchId?: string) => ["analytics", "kpis", branchId] as const,
    revenueTrend: (days: number) => ["analytics", "revenue-trend", days] as const,
    patientGrowth: (days: number) => ["analytics", "patient-growth", days] as const,
    appointmentStatus: (days: number) => ["analytics", "appointment-status", days] as const,
    doctorPerformance: ["analytics", "doctor-performance"] as const,
    insights: ["analytics", "insights"] as const,
  },
  search: {
    global: (query: string) => ["search", "global", query] as const,
  },
};
