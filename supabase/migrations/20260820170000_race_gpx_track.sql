-- Parsed GPX track points per race (array of [lat, lng] pairs), used purely as a visual
-- reference under the checkpoint-placement map in SuperAdmin. The raw GPX file itself isn't
-- kept — only the extracted, downsampled point list needed to draw the route line.
alter table races add column gpx_track jsonb;
