const express = require('express')
const { authenticateAdmin } = require('../../middleware/auth')
const forwardingRuleService = require('../../services/forwardingRuleService')
const logger = require('../../utils/logger')

const router = express.Router()

router.get('/forwarding-rules', authenticateAdmin, async (req, res) => {
  try {
    const rules = await forwardingRuleService.getAllRules(req.query || {})
    res.json({ success: true, data: rules })
  } catch (error) {
    logger.error('Failed to get forwarding rules:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

router.get('/forwarding-rules/account-options', authenticateAdmin, async (req, res) => {
  try {
    const options = await forwardingRuleService.getAccountOptions(
      req.query.platform,
      req.query.keyword
    )
    res.json({ success: true, data: options })
  } catch (error) {
    logger.error('Failed to get forwarding rule account options:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

router.get('/forwarding-rules/:id', authenticateAdmin, async (req, res) => {
  try {
    const rule = await forwardingRuleService.getRule(req.params.id)
    if (!rule) {
      return res.status(404).json({ success: false, message: 'Forwarding rule not found' })
    }

    res.json({ success: true, data: rule })
  } catch (error) {
    logger.error('Failed to get forwarding rule:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

router.post('/forwarding-rules', authenticateAdmin, async (req, res) => {
  try {
    const rule = await forwardingRuleService.createRule(req.body || {})
    res.json({ success: true, data: rule })
  } catch (error) {
    logger.error('Failed to create forwarding rule:', error)
    res.status(400).json({ success: false, message: error.message })
  }
})

router.put('/forwarding-rules/:id', authenticateAdmin, async (req, res) => {
  try {
    const rule = await forwardingRuleService.updateRule(req.params.id, req.body || {})
    res.json({ success: true, data: rule })
  } catch (error) {
    logger.error('Failed to update forwarding rule:', error)
    const status = error.message === 'Forwarding rule not found' ? 404 : 400
    res.status(status).json({ success: false, message: error.message })
  }
})

router.put('/forwarding-rules/:id/toggle', authenticateAdmin, async (req, res) => {
  try {
    const rule = await forwardingRuleService.toggleRule(req.params.id, req.body?.enabled)
    res.json({ success: true, data: rule })
  } catch (error) {
    logger.error('Failed to toggle forwarding rule:', error)
    const status = error.message === 'Forwarding rule not found' ? 404 : 400
    res.status(status).json({ success: false, message: error.message })
  }
})

router.delete('/forwarding-rules/:id', authenticateAdmin, async (req, res) => {
  try {
    const result = await forwardingRuleService.deleteRule(req.params.id)
    res.json({ success: true, data: result })
  } catch (error) {
    logger.error('Failed to delete forwarding rule:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

module.exports = router
