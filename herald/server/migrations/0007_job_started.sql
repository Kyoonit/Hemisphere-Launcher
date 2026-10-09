-- Phase S6: when GitHub Actions took the job (Herald shows each step of a publication live: queued → checking and
-- signing → on GitHub → launchers)
ALTER TABLE publish_jobs ADD COLUMN started_at INTEGER;
