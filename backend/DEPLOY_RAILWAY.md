Railway deployment steps for the backend

1. Push your branch to GitHub (already done).
2. In Railway, create a new project -> Deploy from GitHub and link the repository and branch.
3. Railway will detect a Dockerfile and build the image. If prompted, set the `Build Command` to empty and `Start Command` to the default.
4. Add the required environment variables in Railway project settings:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (service_role key — keep secret)
   - `GROQ_API_KEY` (if using GROQ)
   - `ADMIN_USERNAME` and `ADMIN_PASSWORD`
5. Set the `PORT` environment variable (Railway sets this automatically; no action required).
6. Deploy and check the `/health` endpoint on the provided Railway URL.

Notes:
- Do NOT put secrets into the repository. Use the Railway environment variable UI to store secrets.
- If the image build fails due to large packages (torch/ultralytics), consider using a lighter model or use a prebuilt Docker base image with PyTorch.
