# EduPulse AWS Deployment Script
# Run this ONCE to set up everything on AWS free tier
# Usage: .\deploy-aws.ps1

$REGION     = "ap-south-1"
$APP_NAME   = "edupulse"
$DB_NAME    = "edupulse"
$DB_USER    = "edupulse_admin"
$KEY_NAME   = "edupulse-key"

Write-Host "`n🚀 EduPulse AWS Setup Starting...`n" -ForegroundColor Cyan

# ── Step 1: Create Key Pair ──────────────────────────────────────
Write-Host "Step 1: Creating EC2 Key Pair..." -ForegroundColor Yellow
aws ec2 create-key-pair `
  --key-name $KEY_NAME `
  --query "KeyMaterial" `
  --output text `
  --region $REGION > "$APP_NAME-key.pem"
Write-Host "✅ Key saved to $APP_NAME-key.pem" -ForegroundColor Green

# ── Step 2: Create Security Group ───────────────────────────────
Write-Host "`nStep 2: Creating Security Group..." -ForegroundColor Yellow
$SG_ID = aws ec2 create-security-group `
  --group-name "$APP_NAME-sg" `
  --description "EduPulse API Security Group" `
  --region $REGION `
  --query "GroupId" --output text

# Allow HTTP, HTTPS, SSH, API port
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22   --cidr 0.0.0.0/0 --region $REGION
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80   --cidr 0.0.0.0/0 --region $REGION
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 443  --cidr 0.0.0.0/0 --region $REGION
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 3001 --cidr 0.0.0.0/0 --region $REGION
Write-Host "✅ Security Group created: $SG_ID" -ForegroundColor Green

# ── Step 3: Launch EC2 (t2.micro - FREE) ────────────────────────
Write-Host "`nStep 3: Launching EC2 t2.micro instance..." -ForegroundColor Yellow
# Amazon Linux 2023 AMI for ap-south-1
$AMI_ID = "ami-0f58b397bc5c1f2e8"

$USER_DATA = @"
#!/bin/bash
yum update -y
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs git
npm install -g pm2
mkdir -p /app
cd /app
git clone https://github.com/ArvionEcoSystem/EduPulse.git .
cd backend
npm install --production
pm2 start src/server.js --name edupulse-api
pm2 startup
pm2 save
"@

$USER_DATA_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($USER_DATA))

$INSTANCE_ID = aws ec2 run-instances `
  --image-id $AMI_ID `
  --instance-type t2.micro `
  --key-name $KEY_NAME `
  --security-group-ids $SG_ID `
  --user-data $USER_DATA_B64 `
  --region $REGION `
  --query "Instances[0].InstanceId" --output text

Write-Host "✅ EC2 Instance launched: $INSTANCE_ID" -ForegroundColor Green
Write-Host "   Waiting for instance to start..." -ForegroundColor Gray

aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION

$PUBLIC_IP = aws ec2 describe-instances `
  --instance-ids $INSTANCE_ID `
  --region $REGION `
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text

Write-Host "✅ EC2 Public IP: $PUBLIC_IP" -ForegroundColor Green

# ── Step 4: Create RDS PostgreSQL (t3.micro - FREE) ─────────────
Write-Host "`nStep 4: Creating RDS PostgreSQL database..." -ForegroundColor Yellow
$DB_PASSWORD = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object {[char]$_})

aws rds create-db-instance `
  --db-instance-identifier "$APP_NAME-db" `
  --db-instance-class db.t3.micro `
  --engine postgres `
  --engine-version "15.4" `
  --master-username $DB_USER `
  --master-user-password $DB_PASSWORD `
  --allocated-storage 20 `
  --db-name $DB_NAME `
  --vpc-security-group-ids $SG_ID `
  --publicly-accessible `
  --no-multi-az `
  --region $REGION | Out-Null

Write-Host "✅ RDS creating (takes ~5 min)..." -ForegroundColor Green
Write-Host "   Waiting for database..." -ForegroundColor Gray

aws rds wait db-instance-available --db-instance-identifier "$APP_NAME-db" --region $REGION

$DB_HOST = aws rds describe-db-instances `
  --db-instance-identifier "$APP_NAME-db" `
  --region $REGION `
  --query "DBInstances[0].Endpoint.Address" --output text

Write-Host "✅ RDS Endpoint: $DB_HOST" -ForegroundColor Green

# ── Step 5: Save .env file ───────────────────────────────────────
$JWT_SECRET = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})

$ENV_CONTENT = @"
PORT=3001
NODE_ENV=production
DB_HOST=$DB_HOST
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d
AWS_REGION=$REGION
SNS_ENABLED=false
"@

$ENV_CONTENT | Out-File -FilePath ".env" -Encoding UTF8
Write-Host "✅ .env file created" -ForegroundColor Green

# ── Summary ──────────────────────────────────────────────────────
Write-Host "`n" + "="*50 -ForegroundColor Cyan
Write-Host "🎉 EduPulse AWS Setup Complete!" -ForegroundColor Green
Write-Host "="*50 -ForegroundColor Cyan
Write-Host ""
Write-Host "API URL:     http://$PUBLIC_IP`:3001" -ForegroundColor White
Write-Host "Health:      http://$PUBLIC_IP`:3001/health" -ForegroundColor White
Write-Host "DB Host:     $DB_HOST" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  Save these details securely!" -ForegroundColor Yellow
Write-Host "⚠️  Update the mobile app API_URL to: http://$PUBLIC_IP`:3001" -ForegroundColor Yellow
Write-Host ""

# Save summary
@"
API_URL=http://$PUBLIC_IP`:3001
DB_HOST=$DB_HOST
INSTANCE_ID=$INSTANCE_ID
"@ | Out-File -FilePath "aws-config.txt" -Encoding UTF8
