-- Receptionist approval of patient self-booked appointments, step 1 of 2:
-- new enum values only. Kept in its own migration because PostgreSQL can't use
-- a newly added enum value in the same transaction that adds it; step 2
-- (20261030000100_patient_booking_approval) uses them.
--
-- * PENDING_APPROVAL: a patient's own booking, holding its slot until reception
--   approves (→ CONFIRMED) or rejects it.
-- * REJECTED: a declined request. Keeps the row and its audit history; frees the slot.
-- * BOOKING_REQUESTED: in-app notification to the branch's appointment staff.
-- Additive only.

ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_REQUESTED';
