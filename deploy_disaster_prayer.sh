#!/bin/bash

# Disaster Prayer Redesign - Deployment Script
# This script deploys the disaster prayer service updates to Cloud Run
# and sets up the hourly Cloud Scheduler job

set -e  # Exit on error

echo "🚀 Starting Disaster Prayer Redesign Deployment..."
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Set project
echo -e "${YELLOW}Step 1: Setting GCP project...${NC}"
gcloud config set project divinebridge
echo -e "${GREEN}✓ Project set${NC}"
echo ""

# Step 2: Deploy to Cloud Run
echo -e "${YELLOW}Step 2: Deploying to Cloud Run...${NC}"
gcloud run deploy divinebridge \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --min-instances 0 \
  --port 5001

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Deployment successful${NC}"
else
  echo -e "${RED}✗ Deployment failed${NC}"
  exit 1
fi
echo ""

# Step 3: Get Cloud Run URL
echo -e "${YELLOW}Step 3: Getting Cloud Run URL...${NC}"
CLOUD_RUN_URL=$(gcloud run services describe divinebridge \
  --region us-central1 \
  --format="value(status.url)")
echo -e "${GREEN}✓ Cloud Run URL: ${CLOUD_RUN_URL}${NC}"
echo ""

# Step 4: Verify service account exists
echo -e "${YELLOW}Step 4: Verifying service account...${NC}"
if gcloud iam service-accounts describe prayer-scheduler@divinebridge.iam.gserviceaccount.com &>/dev/null; then
  echo -e "${GREEN}✓ Service account exists${NC}"
else
  echo -e "${YELLOW}Creating service account...${NC}"
  gcloud iam service-accounts create prayer-scheduler \
    --display-name="Prayer Scheduler Service Account"
  
  gcloud run services add-iam-policy-binding divinebridge \
    --region=us-central1 \
    --member=serviceAccount:prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --role=roles/run.invoker
  echo -e "${GREEN}✓ Service account created and configured${NC}"
fi
echo ""

# Step 5: Create or update Cloud Scheduler job
echo -e "${YELLOW}Step 5: Setting up Cloud Scheduler job...${NC}"

# Check if job already exists
if gcloud scheduler jobs describe disaster-prayer-hourly --location=us-central1 &>/dev/null; then
  echo -e "${YELLOW}Job exists, updating...${NC}"
  gcloud scheduler jobs update http disaster-prayer-hourly \
    --location=us-central1 \
    --schedule="0 */4 * * *" \
    --time-zone="UTC" \
    --uri="${CLOUD_RUN_URL}/api/disasters/generate-hourly" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="${CLOUD_RUN_URL}" \
    --description="Every 4 hours breaking news search and disaster prayer generation"
  echo -e "${GREEN}✓ Scheduler job updated${NC}"
else
  echo -e "${YELLOW}Creating new scheduler job...${NC}"
  gcloud scheduler jobs create http disaster-prayer-hourly \
    --location=us-central1 \
    --schedule="0 */4 * * *" \
    --time-zone="UTC" \
    --uri="${CLOUD_RUN_URL}/api/disasters/generate-hourly" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="${CLOUD_RUN_URL}" \
    --description="Every 4 hours breaking news search and disaster prayer generation"
  echo -e "${GREEN}✓ Scheduler job created${NC}"
fi
echo ""

# Step 6: Verify deployment
echo -e "${YELLOW}Step 6: Verifying deployment...${NC}"
echo "Cloud Run URL: ${CLOUD_RUN_URL}"
echo "Disasters page: ${CLOUD_RUN_URL}/disasters"
echo "Hourly endpoint: ${CLOUD_RUN_URL}/api/disasters/generate-hourly"
echo ""

# Step 7: Test manual trigger (optional)
read -p "Do you want to test the scheduler job now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Testing scheduler job...${NC}"
  gcloud scheduler jobs run disaster-prayer-hourly --location=us-central1
  echo -e "${GREEN}✓ Test trigger sent${NC}"
  echo ""
  echo "Check logs with:"
  echo "  gcloud logging read \"resource.type=cloud_scheduler_job AND resource.labels.job_id=disaster-prayer-hourly\" --limit=10"
fi

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Visit ${CLOUD_RUN_URL}/disasters to see the new design"
echo "2. Monitor logs: gcloud run services logs read divinebridge --region us-central1 --limit=50"
echo "3. Check scheduler: gcloud scheduler jobs describe disaster-prayer-hourly --location=us-central1"
echo ""
