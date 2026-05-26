from pi_requests import handle_pi_request, reject_pi_request


def lambda_handler(event, context):
  return handle_pi_request(reject_pi_request, event)
