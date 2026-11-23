-- Login-time lookups that run before any RLS context exists. SECURITY DEFINER,
-- narrow outputs, fixed search_path.
CREATE OR REPLACE FUNCTION app.resolve_org(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT id FROM orgs WHERE slug = p_slug $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_user(p_org uuid, p_auth_user_id uuid, p_email text)
  RETURNS TABLE (id uuid, org_id uuid, name text, email text, role user_role, active boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  -- link a Supabase auth user to the matching CRM user on first login (by email)
  IF p_auth_user_id IS NOT NULL THEN
    UPDATE users u SET auth_user_id = p_auth_user_id
     WHERE u.org_id = p_org AND u.auth_user_id IS NULL AND lower(u.email) = lower(p_email);
  END IF;
  RETURN QUERY
    SELECT u.id, u.org_id, u.name, u.email, u.role, u.active FROM users u
     WHERE u.org_id = p_org AND u.active
       AND ((p_auth_user_id IS NOT NULL AND u.auth_user_id = p_auth_user_id)
            OR (p_auth_user_id IS NULL AND lower(u.email) = lower(p_email)));
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.dev_users(p_org uuid)
  RETURNS TABLE (id uuid, name text, email text, role user_role)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT id, name, email, role FROM users WHERE org_id = p_org AND active ORDER BY role, name $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_org(text), app.resolve_user(uuid, uuid, text), app.dev_users(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_org(text), app.resolve_user(uuid, uuid, text), app.dev_users(uuid) TO luxel_app;
