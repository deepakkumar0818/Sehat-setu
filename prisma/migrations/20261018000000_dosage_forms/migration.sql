-- Six more dosage forms for the shared medicine catalogue (approved).
-- Additive only: existing enum values and every existing medicine row are
-- unchanged. Kept in its own migration so the new values are committed before
-- anything could use them (PostgreSQL doesn't allow using an enum value in the
-- transaction that added it).
ALTER TYPE "DosageForm" ADD VALUE IF NOT EXISTS 'CREAM';
ALTER TYPE "DosageForm" ADD VALUE IF NOT EXISTS 'GEL';
ALTER TYPE "DosageForm" ADD VALUE IF NOT EXISTS 'LOTION';
ALTER TYPE "DosageForm" ADD VALUE IF NOT EXISTS 'SUSPENSION';
ALTER TYPE "DosageForm" ADD VALUE IF NOT EXISTS 'POWDER';
ALTER TYPE "DosageForm" ADD VALUE IF NOT EXISTS 'SACHET';
