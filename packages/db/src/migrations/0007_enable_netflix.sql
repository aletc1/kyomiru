-- Enable Netflix provider and add the episode deep-link template.
UPDATE providers
   SET enabled = true,
       episode_url_template = 'https://www.netflix.com/watch/{externalId}'
 WHERE key = 'netflix';
