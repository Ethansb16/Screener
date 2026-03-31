import { Router } from 'express';
import { listOpportunities, getOpportunityDetail } from './queries.js';
import { renderLayout, renderFeedPage, renderDetail } from './templates.js';

export const dashboardRouter = Router();

// GET / — Feed list
dashboardRouter.get('/', async (req, res) => {
  const opportunities = listOpportunities();
  const fragment = renderFeedPage(opportunities);
  if (req.headers['hx-request']) {
    res.send(fragment);
  } else {
    res.send(renderLayout(fragment));
  }
});

// GET /opportunities/:id — Detail view
dashboardRouter.get('/opportunities/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).send('<p>Invalid opportunity ID</p>');
  }
  const detail = getOpportunityDetail(id);
  if (!detail) {
    return res.status(404).send('<p>Opportunity not found</p>');
  }
  const fragment = renderDetail(detail);
  if (req.headers['hx-request']) {
    res.send(fragment);
  } else {
    res.send(renderLayout(fragment));
  }
});
