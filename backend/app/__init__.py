import os

# Set at image build time from the git tag (CalVer, e.g. 2026.08.31). The
# fallback is what you get running from a source checkout.
__version__ = os.environ.get("APP_VERSION") or "dev"
