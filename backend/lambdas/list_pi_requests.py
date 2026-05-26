from pi_requests import handle_pi_request, list_pi_requests


def lambda_handler(event, context):
  return handle_pi_request(list_pi_requests, event)
