// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

contract IncomingAdversarialToken {
    enum TransferMode {
        NORMAL,
        RETURN_FALSE,
        REVERT_CALL,
        NO_RETURN,
        MALFORMED_RETURN,
        FEE_ON_TRANSFER,
        OVERCREDIT,
        REENTER
    }

    enum BalanceMode {
        NORMAL,
        REVERT_CALL,
        MALFORMED_RETURN
    }

    string public constant name = "Challenge Escrow Test Unit";
    string public constant symbol = "ceTEST";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    TransferMode public transferMode;
    BalanceMode public balanceMode;
    address public reentryTarget;
    bytes public reentryCalldata;
    bool public reentrySucceeded;
    bytes4 public reentryResultSelector;

    mapping(address account => uint256 amount) private _balances;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setTransferMode(TransferMode mode) external {
        transferMode = mode;
    }

    function setBalanceMode(BalanceMode mode) external {
        balanceMode = mode;
    }

    function setReentry(address target, bytes calldata callData) external {
        reentryTarget = target;
        reentryCalldata = callData;
        reentrySucceeded = false;
        reentryResultSelector = bytes4(0);
    }

    function balanceOf(address account) external view returns (uint256) {
        if (balanceMode == BalanceMode.REVERT_CALL) revert("BALANCE_REVERT");
        if (balanceMode == BalanceMode.MALFORMED_RETURN) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        return _balances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        TransferMode mode = transferMode;
        if (mode == TransferMode.REVERT_CALL) revert("TRANSFER_REVERT");
        if (mode == TransferMode.RETURN_FALSE) return false;

        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ALLOWANCE");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;

        if (mode == TransferMode.REENTER) {
            (bool succeeded, bytes memory result) = reentryTarget.call(reentryCalldata);
            reentrySucceeded = succeeded;
            if (result.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(result, 0x20))
                }
                reentryResultSelector = selector;
            }
        }

        uint256 credited = amount;
        if (mode == TransferMode.FEE_ON_TRANSFER) credited = amount - 1;
        if (mode == TransferMode.OVERCREDIT) credited = amount + 1;
        _move(from, to, amount, credited);

        if (mode == TransferMode.NO_RETURN) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (mode == TransferMode.MALFORMED_RETURN) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(31, 1)
            }
        }
        return true;
    }

    function rawBalanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function _move(address from, address to, uint256 debited, uint256 credited) private {
        require(_balances[from] >= debited, "BALANCE");
        _balances[from] -= debited;
        _balances[to] += credited;
        if (credited > debited) totalSupply += credited - debited;
        if (debited > credited) totalSupply -= debited - credited;
        emit Transfer(from, to, credited);
    }
}
