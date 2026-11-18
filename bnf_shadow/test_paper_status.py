"""Allowlisted SHADOW paper receipt stays read-only and credential-free."""
import threading
import unittest
from .__main__ import paper_status


class _Engine:
    def __init__(self, active=None, last=None):
        self.lock = threading.RLock()
        self.snapshot = {'active': active, 'last_result': last}


class PaperStatusTest(unittest.TestCase):
    def test_empty_is_not_a_claim_of_fills(self):
        result = paper_status(_Engine())
        self.assertEqual(result['status'], 'SHADOW_EXECUTION_STATUS')
        self.assertIsNone(result['active'])
        self.assertIsNone(result['last_result'])
        self.assertEqual(result['broker_orders'], 0)

    def test_fills_are_reported_without_identifying_payloads(self):
        trade = {'state': 'OPEN', 'requested_qty': 60, 'filled_qty': 30,
                 'exited_qty': 0, 'account': 'must-not-leak', 'intent_id': 'private'}
        result = paper_status(_Engine(active=trade))
        self.assertEqual(result['active'],
                         {'state': 'OPEN', 'requested_qty': 60, 'filled_qty': 30, 'exited_qty': 0})
        self.assertNotIn('account', str(result))
        self.assertNotIn('private', str(result))
        self.assertIsNone(result['last_result'])

    def test_malformed_quantity_fails_closed(self):
        bad = {'state': 'PENDING', 'requested_qty': '60', 'filled_qty': -1, 'exited_qty': True}
        result = paper_status(_Engine(last=bad))
        self.assertIsNone(result['last_result']['requested_qty'])
        self.assertIsNone(result['last_result']['filled_qty'])
        self.assertIsNone(result['last_result']['exited_qty'])


if __name__ == '__main__':
    unittest.main()
