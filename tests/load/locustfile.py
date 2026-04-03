"""
Load testing with Locust for DivineBridge API.

Run:
    pip install locust
    locust -f tests/load/locustfile.py --host https://divinebridge-staging-xxxxx.run.app

Then open http://localhost:8089 to configure user count and spawn rate.
"""

from locust import HttpUser, task, between, tag
from datetime import datetime


class DivineBridgeUser(HttpUser):
    wait_time = between(1, 5)

    @tag("critical")
    @task(10)
    def home_bundle(self):
        """Most common request: Home screen loads daily verse + prayer."""
        date = datetime.now().strftime("%Y-%m-%d")
        self.client.get(f"/api/home-bundle?client_date={date}", name="/api/home-bundle")

    @tag("critical")
    @task(8)
    def today_verse(self):
        date = datetime.now().strftime("%Y-%m-%d")
        self.client.get(f"/api/today-verse?client_date={date}", name="/api/today-verse")

    @tag("critical")
    @task(6)
    def daily_prayer(self):
        date = datetime.now().strftime("%Y-%m-%d")
        self.client.get(f"/api/prayer/prayer/{date}", name="/api/prayer/prayer/{date}")

    @tag("browse")
    @task(4)
    def prayer_requests(self):
        date = datetime.now().strftime("%Y-%m-%d")
        self.client.get(
            f"/api/prayer/prayers?client_date={date}",
            name="/api/prayer/prayers",
        )

    @tag("browse")
    @task(3)
    def rooms_list(self):
        self.client.get("/api/prayer-room/rooms", name="/api/prayer-room/rooms")

    @tag("browse")
    @task(2)
    def scheduled_sessions(self):
        self.client.get(
            "/api/prayer-room/public-scheduled-sessions",
            name="/api/prayer-room/public-scheduled-sessions",
        )

    @tag("health")
    @task(1)
    def health_check(self):
        self.client.get("/_ah/health", name="/_ah/health")

    @tag("static")
    @task(3)
    def static_css(self):
        self.client.get("/static/css/styles.css", name="/static/css/styles.css")
