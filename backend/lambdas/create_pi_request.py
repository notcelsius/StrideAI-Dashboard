from pi_requests import create_pi_request, handle_pi_request


def lambda_handler(event, context):
  return handle_pi_request(create_pi_request, event)
