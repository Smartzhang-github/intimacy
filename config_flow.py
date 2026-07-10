"""Config flow for intimacy."""
from __future__ import annotations

from homeassistant.config_entries import ConfigFlow


class IntimacyConfigFlow(ConfigFlow, domain="intimacy"):
    """Handle a config flow for intimacy."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if self._async_in_progress(False):
            return self.async_abort(reason="single_instance_allowed")
        
        if user_input is not None:
            return self.async_create_entry(
                title="私密记录",
                data={},
            )

        return self.async_show_form(
            step_id="user",
        )
