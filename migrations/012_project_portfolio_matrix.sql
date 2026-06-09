-- migrations/012_project_portfolio_matrix.sql
-- Add Portfolio Matrix tracking columns to the projects table
-- See SKILL: roi-scoring.md for the mathematical mapping

BEGIN;

ALTER TABLE projects
  ADD COLUMN business_value INT CHECK (business_value IN (1, 3, 5)),
  ADD COLUMN strategic_fit INT CHECK (strategic_fit IN (1, 3, 5)),
  ADD COLUMN effort INT CHECK (effort IN (1, 3, 5)),
  ADD COLUMN risk_index INT DEFAULT 1 CHECK (risk_index BETWEEN 1 AND 5);

COMMIT;
