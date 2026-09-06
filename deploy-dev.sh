#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="cherry-backend"
PROJECT_ID="cherry-mvp"
REGION="europe-west2"

ENV_VARS="NODE_ENV=production,FIREBASE_PROJECT_ID=${PROJECT_ID},SENDCLOUD_MODE=live,SENDCLOUD_LABEL_MODE=test,EMAIL_MODE=live"
SECRETS="FIREBASE_API_KEY=FIREBASE_API_KEY:latest,\
STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest,\
STRIPE_PUBLISHABLE_KEY=STRIPE_PUBLISHABLE_KEY:latest,\
SENDCLOUD_PUBLIC_KEY=SENDCLOUD_PUBLIC_KEY:latest,\
SENDCLOUD_SECRET_KEY=SENDCLOUD_SECRET_KEY:latest,\
SENDCLOUD_API_URL=SENDCLOUD_API_URL:latest,\
SENDCLOUD_SERVICE_POINTS_API_URL=SENDCLOUD_SERVICE_POINTS_API_URL:latest,\
SENDCLOUD_ENFORCED_CARRIER=SENDCLOUD_ENFORCED_CARRIER:latest,\
RESEND_API_KEY=RESEND_API_KEY:latest,\
RESEND_FROM_EMAIL=RESEND_FROM_EMAIL:latest"

echo "Deploying ${SERVICE_NAME} to project ${PROJECT_ID} (${REGION})..."
gcloud config set project "${PROJECT_ID}" >/dev/null

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "${ENV_VARS}" \
  --set-secrets "${SECRETS}"

echo "Deployment finished."
