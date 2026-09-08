-- =============================================================================
-- Migration 0020: Always notify when assigned to an issue (on INSERT & UPDATE)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_issue_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := coalesce(auth.uid(), new.reporter_id);
  v_member record;
BEGIN
  -- 1. On INSERT: Notify assignee if task is created with an assignee
  IF (TG_OP = 'INSERT') THEN
    IF new.assignee_id IS NOT NULL THEN
      PERFORM public.create_notification(
        new.assignee_id,
        v_actor,
        'ISSUE_ASSIGNED',
        format('Issue #%s assigned to you', new.issue_number),
        new.title,
        new.project_id,
        new.id
      );
    END IF;

  -- 2. On UPDATE: Notify when assignee changes or status changes
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Notify when assignee is assigned or changed
    IF new.assignee_id IS DISTINCT FROM old.assignee_id AND new.assignee_id IS NOT NULL THEN
      PERFORM public.create_notification(
        new.assignee_id,
        v_actor,
        'ISSUE_ASSIGNED',
        format('Issue #%s assigned to you', new.issue_number),
        new.title,
        new.project_id,
        new.id
      );
    END IF;

    -- Status transitions
    IF new.status IS DISTINCT FROM old.status THEN
      IF new.status = 'FOR_TESTING' THEN
        FOR v_member IN
          SELECT user_id FROM public.project_members
          WHERE project_id = new.project_id AND role IN ('QA', 'OWNER') AND user_id <> v_actor
        LOOP
          PERFORM public.create_notification(
            v_member.user_id,
            v_actor,
            'READY_FOR_TESTING',
            format('Issue #%s is ready for testing', new.issue_number),
            new.title,
            new.project_id,
            new.id
          );
        END LOOP;

      ELSIF new.status = 'PASSED' THEN
        IF new.reporter_id IS NOT NULL THEN
          PERFORM public.create_notification(
            new.reporter_id,
            v_actor,
            'QA_PASSED',
            format('Issue #%s passed QA', new.issue_number),
            new.title,
            new.project_id,
            new.id
          );
        END IF;
        IF new.assignee_id IS NOT NULL AND new.assignee_id IS DISTINCT FROM new.reporter_id THEN
          PERFORM public.create_notification(
            new.assignee_id,
            v_actor,
            'QA_PASSED',
            format('Issue #%s passed QA', new.issue_number),
            new.title,
            new.project_id,
            new.id
          );
        END IF;

      ELSIF new.status = 'FAILED' THEN
        IF new.assignee_id IS NOT NULL THEN
          PERFORM public.create_notification(
            new.assignee_id,
            v_actor,
            'QA_FAILED',
            format('Issue #%s failed QA verification', new.issue_number),
            new.title,
            new.project_id,
            new.id
          );
        END IF;

      ELSIF new.status = 'DONE' THEN
        IF new.reporter_id IS NOT NULL THEN
          PERFORM public.create_notification(
            new.reporter_id,
            v_actor,
            'ISSUE_DONE',
            format('Issue #%s was marked done', new.issue_number),
            new.title,
            new.project_id,
            new.id
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$;

-- Drop and recreate the trigger to fire on both INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_notify_issue_changes ON public.issues;
CREATE TRIGGER trg_notify_issue_changes
AFTER INSERT OR UPDATE ON public.issues
FOR EACH ROW EXECUTE FUNCTION public.notify_issue_changes();
