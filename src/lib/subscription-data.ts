import type { SubscriptionInvoice, SubscriptionPlan } from "@/types";

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 1999,
    branchLimit: 1,
    userLimit: 10,
    features: ["1 branch", "Up to 10 staff accounts", "Patient records & appointments", "Basic billing", "Email support"],
  },
  {
    id: "professional",
    name: "Professional",
    priceMonthly: 4999,
    branchLimit: 5,
    userLimit: 50,
    features: ["Up to 5 branches", "Up to 50 staff accounts", "AI clinical documentation", "Advanced analytics", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceMonthly: 0,
    branchLimit: Infinity,
    userLimit: Infinity,
    features: ["Unlimited branches", "Unlimited staff accounts", "Custom AI integrations", "Dedicated account manager", "SLA-backed support"],
  },
];

export const CURRENT_PLAN_ID = "professional";

export const SUBSCRIPTION_INVOICES: SubscriptionInvoice[] = [
  { id: "SUB-2026-08", date: "2026-08-01", amount: 4999, status: "paid", planName: "Professional" },
  { id: "SUB-2026-07", date: "2026-07-01", amount: 4999, status: "paid", planName: "Professional" },
  { id: "SUB-2026-06", date: "2026-06-01", amount: 4999, status: "paid", planName: "Professional" },
  { id: "SUB-2026-05", date: "2026-05-01", amount: 1999, status: "paid", planName: "Starter" },
  { id: "SUB-2026-04", date: "2026-04-01", amount: 1999, status: "paid", planName: "Starter" },
];
