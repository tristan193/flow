# LEGACY — do not use for production.
# Daily harvest runs on GitHub Actions (.github/workflows/daily-harvest.yml).
# This script previously registered a Windows task on Tristan's PC; that was removed.

Write-Host "Refusing to register a PC scheduled task."
Write-Host "Daily harvest is cloud-only via GitHub Actions (workflow: Daily harvest)."
Write-Host "See pipeline/GMAIL_SETUP.md"
exit 1
