from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3000")
    page.wait_for_load_state("networkidle")

    # Check if we are already logged in by looking for a key element on the dashboard
    try:
        page.wait_for_selector('text="New Deployment"', timeout=10000) # Wait 10s
        print("Already logged in.")
    except:
        print("Not logged in, attempting to sign in.")
        # If not logged in, click the sign-in button
        page.click('text="Sign in with GitHub"')
        # Wait for navigation to the dashboard after login
        page.wait_for_selector('text="New Deployment"', timeout=60000) # Wait 60s

    # Now on the dashboard, we can proceed with verification
    # For this task, a screenshot of the initial dashboard is sufficient
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
